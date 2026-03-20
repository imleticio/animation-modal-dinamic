import { gsap } from 'gsap'
import { Draggable } from 'gsap/dist/Draggable'

gsap.registerPlugin(Draggable)
import {
    useCallback,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type ReactNode,
    type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'

/* ── geometry tokens ── */
const DEFAULT_CLOSED_WIDTH = 176
const DEFAULT_CLOSED_HEIGHT = 64
const DEFAULT_CLOSED_RADIUS = 999
const CLOSED_PADDING = 8
const OPEN_RADIUS = 44
const VIEWPORT_MARGIN = 16
const DRAG_CLOSE_THRESHOLD = 110
const OPEN_BACKDROP_BLUR = 22
const DRAG_GRAB_SCALE = 0.992
const DRAG_PULL_SCALE = 0.088
const DRAG_MODAL_PULL_SCALE = 0.12

/* ── motion-blur tokens ── */
const MOTION_BLUR_OPEN_PEAK = 18          // max vertical blur on open (subtle directional streak)
const MOTION_BLUR_CLOSE_PEAK = 8          // max vertical blur on close
const MOTION_BLUR_HORIZONTAL = 2          // subtle horizontal spread
const DRAG_CONTENT_PULL_SCALE = 0.06
const DRAG_PRE_CLOSE_SCALE = 0.92

/* ── easings ── */
const MORPH_EASE = 'power4.out'           // fast attack, smooth decel
const SETTLE_EASE = 'back.out(1.4)'       // clean overshoot-and-snap
const BLUR_EASE = 'power2.inOut'

function clamp(v: number, lo: number, hi: number) {
    return Math.min(Math.max(v, lo), hi)
}

function px(value: number) {
    return `${Math.round(value * 100) / 100}px`
}

function getEffectiveBorderRadius(triggerEl: HTMLElement) {
    const computed = getComputedStyle(triggerEl)
    const parsedRadius = parseFloat(computed.borderTopLeftRadius || computed.borderRadius)
    const { width, height } = triggerEl.getBoundingClientRect()
    const maxEffectiveRadius = Math.min(width, height) / 2

    if (Number.isNaN(parsedRadius) || parsedRadius < 0) {
        return maxEffectiveRadius || DEFAULT_CLOSED_RADIUS
    }

    return Math.min(parsedRadius, maxEffectiveRadius || parsedRadius)
}

function getOpenMetrics() {
    const width = Math.min(window.innerWidth * 0.92, 430)
    const height = clamp(window.innerHeight * 0.72, 360, 500)
    const padding = window.innerWidth < 640 ? 16 : 22
    return { width, height, padding }
}

function getOpenMorphRadii(closedRadius: number) {
    const softRadius = Math.max(closedRadius * 0.38, 24)
    const longRadius = Math.max(closedRadius * 0.78, 44)

    return {
        launch: `${px(softRadius)} ${px(longRadius)} ${px(OPEN_RADIUS * 1.46)} ${px(OPEN_RADIUS * 0.82)} / ${px(longRadius)} ${px(softRadius)} ${px(OPEN_RADIUS * 0.92)} ${px(OPEN_RADIUS * 1.3)}`,
        travel: `${px(OPEN_RADIUS * 1.24)} ${px(OPEN_RADIUS * 0.8)} ${px(OPEN_RADIUS * 1.14)} ${px(OPEN_RADIUS * 0.92)} / ${px(OPEN_RADIUS * 0.88)} ${px(OPEN_RADIUS * 1.34)} ${px(OPEN_RADIUS * 0.96)} ${px(OPEN_RADIUS * 1.12)}`,
        settle: px(OPEN_RADIUS),
    }
}

function getCloseMorphRadii(closedRadius: number) {
    return {
        gather: `${px(OPEN_RADIUS * 1.22)} ${px(OPEN_RADIUS * 0.76)} ${px(closedRadius * 1.3)} ${px(closedRadius * 0.72)} / ${px(OPEN_RADIUS * 0.9)} ${px(OPEN_RADIUS * 1.28)} ${px(closedRadius * 0.9)} ${px(closedRadius * 1.16)}`,
        settle: px(closedRadius),
    }
}

/**
 * Get the clamped left position for the expanded shell so it stays
 * within the viewport. Returns the `left` value the shell should
 * animate to (the shell still uses translateX(-50%)).
 */
function getClampedOpenLeft(anchorCenterX: number) {
    const { width } = getOpenMetrics()
    const halfW = width / 2
    const minLeft = VIEWPORT_MARGIN + halfW
    const maxLeft = window.innerWidth - VIEWPORT_MARGIN - halfW
    return clamp(anchorCenterX, minLeft, maxLeft)
}

/**
 * Get the clamped top position for the expanded shell so it stays
 * within the viewport vertically.
 */
function getClampedOpenTop(anchorTopY: number) {
    const { height } = getOpenMetrics()
    const maxTop = window.innerHeight - VIEWPORT_MARGIN - height
    return clamp(anchorTopY, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, maxTop))
}

/* ═════════════════════════════════════════════════ */

interface DynamicIslandProps {
    /**
     * Custom trigger element rendered as the closed-state button.
     * You provide your own styled button / element; clicking it opens the island.
     * If omitted, a plain text fallback using `triggerLabel` is rendered.
     */
    trigger?: ReactNode
    /** Fallback text when `trigger` is not provided */
    triggerLabel?: string
    /** Content rendered inside the expanded modal */
    children: ReactNode
}

function getPixelValue(target: gsap.TweenTarget, property: string) {
    return Number(gsap.getProperty(target, property)) || 0
}

function getDragCloseProgress(dx: number, dy: number) {
    return clamp(Math.hypot(dx, dy) / DRAG_CLOSE_THRESHOLD, 0, 1)
}

/**
 * Inline SVG filter for directional (anisotropic) motion blur.
 * CSS blur() is always circular; this gives us independent X/Y control.
 */
function MotionBlurSVG({ filterId }: { filterId: string }) {
    return (
        <svg
            width="0"
            height="0"
            style={{ position: 'absolute', pointerEvents: 'none' }}
            aria-hidden
        >
            <defs>
                <filter id={filterId}>
                    <feGaussianBlur
                        in="SourceGraphic"
                        stdDeviation={`${MOTION_BLUR_HORIZONTAL} 0`}
                    />
                </filter>
            </defs>
        </svg>
    )
}

/**
 * Helper: build a CSS `url()` filter pointing at our SVG blur,
 * dynamically updating its stdDeviation via the DOM.
 */
function setMotionBlur(filterId: string, amountX: number, amountY: number) {
    const fe = document.querySelector(
        `#${filterId} feGaussianBlur`,
    )
    if (fe) {
        fe.setAttribute('stdDeviation', `${amountX} ${amountY}`)
    }
}

export default function DynamicIsland({
    trigger,
    triggerLabel = 'ABRIR',
    children,
}: DynamicIslandProps) {
    const instanceId = useId()
    const filterId = `di-motion-blur-${instanceId.replace(/:/g, '')}`

    const [isOpen, setIsOpen] = useState(false)
    const [isAnimating, setIsAnimating] = useState(false)

    /* refs */
    const anchorRef = useRef<HTMLDivElement | null>(null)
    const shellRef = useRef<HTMLElement | null>(null)
    const backdropRef = useRef<HTMLButtonElement | null>(null)
    const closedRef = useRef<HTMLDivElement | null>(null)
    const modalRef = useRef<HTMLDivElement | null>(null)
    const contentRef = useRef<HTMLDivElement | null>(null)
    const glowRef = useRef<HTMLDivElement | null>(null)
    const tlRef = useRef<gsap.core.Timeline | null>(null)
    const draggableRef = useRef<Draggable | null>(null)
    const openPositionRef = useRef({ left: 0, top: 0 })
    const dragStateRef = useRef({ startLeft: 0, startTop: 0, dx: 0, dy: 0 })

    /* measured dimensions of the anchor (trigger content) */
    const [anchorW, setAnchorW] = useState(DEFAULT_CLOSED_WIDTH)
    const [anchorH, setAnchorH] = useState(DEFAULT_CLOSED_HEIGHT)
    const [anchorRadius, setAnchorRadius] = useState(DEFAULT_CLOSED_RADIUS)

    const killTl = useCallback(() => {
        tlRef.current?.kill()
        tlRef.current = null
    }, [])

    const killDraggable = useCallback(() => {
        draggableRef.current?.kill()
        draggableRef.current = null
    }, [])

    const updateDragFeedback = useCallback((dx: number, dy: number) => {
        const shell = shellRef.current
        const backdrop = backdropRef.current
        const modal = modalRef.current
        const content = contentRef.current
        if (!shell || !backdrop || !modal || !content) return

        const progress = getDragCloseProgress(dx, dy)

        gsap.set(shell, {
            scale: DRAG_GRAB_SCALE - progress * DRAG_PULL_SCALE,
            boxShadow: `0 ${40 - progress * 18}px ${120 - progress * 42}px -20px rgba(0,0,0,${0.9 - progress * 0.22}), 0 0 ${60 - progress * 18}px -10px rgba(34,211,238,${0.15 - progress * 0.08})`,
        })
        gsap.set(backdrop, {
            autoAlpha: 1 - progress * 0.28,
            backdropFilter: `blur(${OPEN_BACKDROP_BLUR - progress * 13}px)`,
        })
        gsap.set(modal, {
            autoAlpha: 1,
            x: dx * 0.055,
            y: dy * 0.055,
            scale: 1 - progress * DRAG_MODAL_PULL_SCALE,
            filter: `blur(${progress * 3.4}px)`,
        })
        gsap.set(content, {
            scale: 1 - progress * DRAG_CONTENT_PULL_SCALE,
            filter: `blur(${progress * 4.2}px)`,
        })
    }, [])

    const resetDragPosition = useCallback((animate = false) => {
        const shell = shellRef.current
        const backdrop = backdropRef.current
        const modal = modalRef.current
        const content = contentRef.current
        if (!shell || !backdrop || !modal || !content) return

        const draggable = draggableRef.current
        const { left, top } = openPositionRef.current
        gsap.killTweensOf([shell, backdrop, modal, content])

        if (animate) {
            gsap.to(shell, {
                left,
                top,
                scale: 1,
                duration: 0.24,
                ease: 'back.out(1.2)',
                overwrite: 'auto',
                onUpdate: () => { draggable?.update() },
                onComplete: () => { draggable?.update() },
            })
            gsap.to(backdrop, {
                autoAlpha: 1,
                backdropFilter: `blur(${OPEN_BACKDROP_BLUR}px)`,
                duration: 0.24,
                ease: 'power2.out',
                overwrite: 'auto',
            })
            gsap.to(modal, {
                autoAlpha: 1,
                x: 0,
                y: 0,
                scale: 1,
                filter: 'blur(0px)',
                duration: 0.24,
                ease: 'back.out(1.1)',
                overwrite: 'auto',
            })
            gsap.to(content, {
                scale: 1,
                filter: 'blur(0px)',
                duration: 0.24,
                ease: 'back.out(1.05)',
                overwrite: 'auto',
            })
            gsap.to(shell, {
                boxShadow: '0 40px 120px -20px rgba(0,0,0,0.9), 0 0 60px -10px rgba(34,211,238,0.15)',
                duration: 0.24,
                ease: 'power2.out',
                overwrite: 'auto',
            })
            return
        }

        gsap.set(shell, {
            left,
            top,
            scale: 1,
            boxShadow: '0 40px 120px -20px rgba(0,0,0,0.9), 0 0 60px -10px rgba(34,211,238,0.15)',
        })
        gsap.set(backdrop, { autoAlpha: 1, backdropFilter: `blur(${OPEN_BACKDROP_BLUR}px)` })
        gsap.set(modal, { autoAlpha: 1, x: 0, y: 0, scale: 1, filter: 'blur(0px)' })
        gsap.set(content, { scale: 1, filter: 'blur(0px)' })
        draggable?.update()
    }, [])

    /** Returns center-X and top-Y of the anchor in viewport coords */
    const getAnchorPos = useCallback(() => {
        const anchor = anchorRef.current
        if (!anchor) return { centerX: window.innerWidth / 2, topY: 0 }
        const rect = anchor.getBoundingClientRect()
        return {
            centerX: rect.left + rect.width / 2,
            topY: rect.top,
        }
    }, [])

    /**
     * Snap the shell to the anchor's closed position (no animation).
     */
    const snapShellToAnchor = useCallback(() => {
        const shell = shellRef.current
        if (!shell) return
        const { centerX, topY } = getAnchorPos()
        shell.style.left = `${centerX}px`
        shell.style.top = `${topY}px`
    }, [getAnchorPos])

    const setOpenPosition = useCallback((left: number, top: number) => {
        openPositionRef.current = { left, top }
    }, [])

    /* ── measure anchor size + borderRadius via ResizeObserver ── */
    useEffect(() => {
        const anchor = anchorRef.current
        if (!anchor) return
        const ro = new ResizeObserver(([entry]) => {
            const { width, height } = entry.contentRect
            if (width > 0) setAnchorW(width)
            if (height > 0) setAnchorH(height)

            /* read the trigger radius, clamped to its real visual limit */
            const triggerEl = anchor.querySelector(':scope > div > *') as HTMLElement | null
            if (triggerEl) {
                setAnchorRadius(getEffectiveBorderRadius(triggerEl))
            }
        })
        ro.observe(anchor)
        return () => ro.disconnect()
    }, [])

    /* ── initial GSAP state ── */
    useLayoutEffect(() => {
        const shell = shellRef.current
        const backdrop = backdropRef.current
        const closed = closedRef.current
        const modal = modalRef.current
        const content = contentRef.current
        const glow = glowRef.current

        if (!shell || !backdrop || !closed || !modal || !content) return

        snapShellToAnchor()

        gsap.set(shell, {
            width: anchorW,
            height: anchorH,
            borderRadius: anchorRadius,
            padding: CLOSED_PADDING,
            x: 0,
            y: 0,
            boxShadow: '0 4px 24px -6px rgba(0,0,0,0.45)',
        })
        gsap.set(backdrop, { autoAlpha: 0, backdropFilter: 'blur(0px)' })
        gsap.set(closed, { autoAlpha: 1, scale: 1, filter: 'blur(0px)' })
        gsap.set(modal, { autoAlpha: 0, y: 16, scale: 0.95, filter: 'blur(8px)' })
        gsap.set(content, { filter: 'blur(0px)' })
        if (glow) gsap.set(glow, { autoAlpha: 0, scale: 0.8 })

        return () => {
            killTl()
            killDraggable()
        }
    }, [killTl, killDraggable, snapShellToAnchor, anchorW, anchorH, anchorRadius])

    /* keep shell position in sync on scroll / resize (closed only) */
    useEffect(() => {
        if (isOpen || isAnimating) return
        const sync = () => snapShellToAnchor()
        window.addEventListener('scroll', sync, true)
        window.addEventListener('resize', sync)
        return () => {
            window.removeEventListener('scroll', sync, true)
            window.removeEventListener('resize', sync)
        }
    }, [snapShellToAnchor, isOpen, isAnimating])

    /* ── OPEN ── */
    const open = useCallback(() => {
        if (isAnimating || isOpen) return

        const shell = shellRef.current
        const backdrop = backdropRef.current
        const closed = closedRef.current
        const modal = modalRef.current
        const content = contentRef.current
        const glow = glowRef.current

        if (!shell || !backdrop || !closed || !modal || !content) return

        /* re-sync position before animation starts */
        snapShellToAnchor()

        const { centerX, topY } = getAnchorPos()
        const { width, height, padding } = getOpenMetrics()
        const openLeft = getClampedOpenLeft(centerX)
        const openTop = getClampedOpenTop(topY)

        setIsOpen(true)
        setIsAnimating(true)
        killTl()
        killDraggable()
        setOpenPosition(openLeft, openTop)

        if (modal) modal.style.overflowY = 'hidden'

        const openRadii = getOpenMorphRadii(anchorRadius)

        const tl = gsap.timeline({
            onComplete: () => {
                setIsAnimating(false)
                if (modal) modal.style.overflowY = 'auto'
                /* ensure motion blur is fully cleared */
                setMotionBlur(filterId, 0, 0)
                gsap.set(shell, { filter: 'none', clearProps: 'willChange' })
                gsap.set([modal, content, backdrop], { clearProps: 'willChange' })
            },
        })
        tlRef.current = tl
        gsap.set(shell, { willChange: 'left,top,width,height,border-radius,padding,box-shadow,transform,filter' })
        gsap.set(modal, { willChange: 'transform,opacity,filter' })
        gsap.set(content, { willChange: 'filter,transform' })
        gsap.set(backdrop, { willChange: 'opacity' })

        /* closed content dissolves fast */
        tl.to(closed, {
            autoAlpha: 0, scale: 0.82, filter: 'blur(6px)',
            duration: 0.14, ease: 'power2.in',
        }, 0)

        /* backdrop */
        tl.to(backdrop, {
            autoAlpha: 1, backdropFilter: `blur(${OPEN_BACKDROP_BLUR}px)`,
            duration: 0.4, ease: BLUR_EASE,
        }, 0)

        /* ── motion blur on shell during expansion ── */
        setMotionBlur(filterId, MOTION_BLUR_HORIZONTAL, 0)
        gsap.set(shell, { filter: `url(#${filterId})` })

        /* ramp motion blur up then clear it */
        const mbProxy = { v: 0 }
        tl.to(mbProxy, {
            v: MOTION_BLUR_OPEN_PEAK,
            duration: 0.06,
            ease: 'power3.in',
            onUpdate: () => setMotionBlur(filterId, MOTION_BLUR_HORIZONTAL, mbProxy.v),
        }, 0)
        tl.to(mbProxy, {
            v: 0,
            duration: 0.1,
            ease: 'power2.out',
            onUpdate: () => setMotionBlur(filterId, MOTION_BLUR_HORIZONTAL, mbProxy.v),
            onComplete: () => {
                setMotionBlur(filterId, 0, 0)
                gsap.set(shell, { filter: 'none' })
            },
        }, 0.06)

        /* ── shell morph: 2 phases instead of 3, much tighter ── */

        /* phase 1: quick stretch from trigger → intermediate with liquid radii */
        tl.to(shell, {
            left: openLeft,
            top: openTop,
            width,
            height,
            padding,
            borderRadius: openRadii.travel,
            scaleX: 1.015,
            scaleY: 0.99,
            duration: 0.28,
            ease: MORPH_EASE,
        }, 0.01)

        /* phase 2: settle into final shape — clean snap, no wobble */
        tl.to(shell, {
            borderRadius: openRadii.settle,
            scaleX: 1,
            scaleY: 1,
            duration: 0.16,
            ease: SETTLE_EASE,
        }, 0.26)

        /* shadow bloom */
        tl.to(shell, {
            boxShadow: '0 40px 120px -20px rgba(0,0,0,0.9), 0 0 60px -10px rgba(34,211,238,0.15)',
            duration: 0.35, ease: 'power2.out',
        }, 0.04)

        /* glow pulse */
        if (glow) {
            tl.to(glow, { autoAlpha: 0.6, scale: 1, duration: 0.35, ease: 'power2.out' }, 0.06)
            tl.to(glow, { autoAlpha: 0.25, duration: 0.4, ease: 'power1.inOut' }, 0.4)
        }

        /* modal content reveal — enters EARLIER so the shell never looks empty */
        gsap.set(modal, { autoAlpha: 0, y: 16, scale: 0.95, filter: 'blur(8px)' })
        gsap.set(content, { filter: 'blur(0px)', scale: 1 })
        tl.to(modal, {
            autoAlpha: 1, y: 0, scale: 1, filter: 'blur(0px)',
            duration: 0.32, ease: 'power3.out',
        }, 0.12)
    }, [isAnimating, isOpen, killTl, killDraggable, snapShellToAnchor, getAnchorPos, setOpenPosition, filterId])

    /* ── CLOSE ── */
    const close = useCallback((dragDismiss = false) => {
        if (isAnimating || !isOpen) return

        const shell = shellRef.current
        const backdrop = backdropRef.current
        const closed = closedRef.current
        const modal = modalRef.current
        const content = contentRef.current
        const glow = glowRef.current

        if (!shell || !backdrop || !closed || !modal || !content) return

        const { centerX, topY } = getAnchorPos()
        const { dx, dy } = dragStateRef.current
        const currentLeft = getPixelValue(shell, 'left')
        const currentTop = getPixelValue(shell, 'top')
        const commitLeft = dragDismiss ? currentLeft + dx * 0.08 : currentLeft
        const commitTop = dragDismiss ? currentTop + dy * 0.08 : currentTop
        const exitX = dragDismiss ? dx * 0.22 : 0
        const exitY = dragDismiss ? dy * 0.22 : -4
        const exitBlur = dragDismiss ? 14 : 6

        setIsAnimating(true)
        killTl()
        draggableRef.current?.disable()
        gsap.killTweensOf([shell, backdrop, modal, content])
        if (modal) modal.style.overflowY = 'hidden'
        gsap.set(shell, { willChange: 'left,top,width,height,border-radius,padding,box-shadow,transform' })
        gsap.set(modal, { willChange: 'transform,opacity,filter' })
        gsap.set(content, { willChange: 'filter' })
        gsap.set(backdrop, { willChange: 'opacity' })

        const closeRadii = getCloseMorphRadii(anchorRadius)

        const tl = gsap.timeline({
            onComplete: () => {
                setIsOpen(false)
                setIsAnimating(false)
                snapShellToAnchor()
                dragStateRef.current = { startLeft: 0, startTop: 0, dx: 0, dy: 0 }
                gsap.set(backdrop, { autoAlpha: 0, backdropFilter: 'blur(0px)' })
                gsap.set(modal, { autoAlpha: 0, x: 0, y: 16, scale: 0.95, filter: 'blur(8px)' })
                gsap.set(content, { filter: 'blur(0px)', scale: 1 })
                gsap.set(shell, { scale: 1, filter: 'none', clearProps: 'cursor' })
                gsap.set([shell, modal, content, backdrop], { clearProps: 'willChange' })
                setMotionBlur(filterId, 0, 0)
            },
        })
        tlRef.current = tl

        /* modal content exits quickly */
        tl.to(modal, {
            autoAlpha: 0,
            x: exitX,
            y: exitY,
            scale: dragDismiss ? 0.9 : 0.96,
            filter: `blur(${exitBlur}px)`,
            duration: dragDismiss ? 0.18 : 0.12,
            ease: dragDismiss ? 'power3.out' : 'power3.in',
        }, 0)
        tl.to(content, {
            filter: `blur(${dragDismiss ? 8 : 4}px)`,
            x: dragDismiss ? dx * 0.12 : 0,
            y: dragDismiss ? dy * 0.12 : 0,
            duration: dragDismiss ? 0.14 : 0.1,
            ease: 'power2.in',
        }, 0.01)
        tl.to(content, {
            filter: 'blur(0px)',
            x: 0,
            y: 0,
            duration: dragDismiss ? 0.14 : 0.12,
            ease: 'power1.out',
        }, dragDismiss ? 0.16 : 0.12)

        /* ── motion blur on shell during collapse ── */
        setMotionBlur(filterId, MOTION_BLUR_HORIZONTAL, 0)
        gsap.set(shell, { filter: `url(#${filterId})` })

        const mbCloseProxy = { v: 0 }
        const closeBlurStart = dragDismiss ? 0.03 : 0.01
        tl.to(mbCloseProxy, {
            v: MOTION_BLUR_CLOSE_PEAK,
            duration: 0.06,
            ease: 'power3.in',
            onUpdate: () => setMotionBlur(filterId, MOTION_BLUR_HORIZONTAL, mbCloseProxy.v),
        }, closeBlurStart)
        tl.to(mbCloseProxy, {
            v: 0,
            duration: 0.1,
            ease: 'power2.out',
            onUpdate: () => setMotionBlur(filterId, MOTION_BLUR_HORIZONTAL, mbCloseProxy.v),
            onComplete: () => {
                setMotionBlur(filterId, 0, 0)
                gsap.set(shell, { filter: 'none' })
            },
        }, closeBlurStart + 0.06)

        /* glow out */
        if (glow) {
            tl.to(glow, { autoAlpha: 0, scale: 0.88, duration: 0.18, ease: 'power2.in' }, 0.01)
        }

        /* backdrop fades while shell collapses */
        tl.to(backdrop, {
            autoAlpha: 0,
            duration: 0.2, ease: 'power2.out',
        }, 0)
        tl.set(backdrop, { backdropFilter: 'blur(0px)' }, '>')

        if (dragDismiss) {
            tl.to(shell, {
                left: commitLeft,
                top: commitTop,
                scale: DRAG_PRE_CLOSE_SCALE,
                duration: 0.1,
                ease: 'power2.out',
            }, 0)
        }

        /* ── shell morph: single smooth tween back to trigger (no blob gather) ── */
        tl.to(shell, {
            left: centerX,
            top: topY,
            width: anchorW,
            height: anchorH,
            borderRadius: closeRadii.settle,
            padding: CLOSED_PADDING,
            scaleX: 1,
            scaleY: 1,
            scale: 1,
            duration: dragDismiss ? 0.3 : 0.26,
            ease: 'power4.inOut',
        }, dragDismiss ? 0.06 : 0.02)

        /* shadow collapse */
        tl.to(shell, {
            boxShadow: '0 4px 24px -6px rgba(0,0,0,0.45)',
            duration: 0.22, ease: 'power2.inOut',
        }, 0.03)

        /* closed pill returns near the end */
        tl.fromTo(closed, {
            autoAlpha: 0, scale: 0.985, y: 2, filter: 'blur(3px)',
        }, {
            autoAlpha: 1, scale: 1, y: 0, filter: 'blur(0px)',
            duration: 0.14, ease: 'power2.out',
        }, dragDismiss ? 0.24 : 0.2)
    }, [isAnimating, isOpen, killTl, getAnchorPos, snapShellToAnchor, anchorW, anchorH, anchorRadius, filterId])

    /* ── Escape key ── */
    useEffect(() => {
        const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
        window.addEventListener('keydown', onEsc)
        return () => window.removeEventListener('keydown', onEsc)
    }, [close])

    /* ── responsive resize (open state) ── */
    useEffect(() => {
        if (!isOpen || isAnimating) return
        const shell = shellRef.current
        if (!shell) return
        const onResize = () => {
            const { centerX, topY } = getAnchorPos()
            const { width, height, padding } = getOpenMetrics()
            const openLeft = getClampedOpenLeft(centerX)
            const openTop = getClampedOpenTop(topY)
            setOpenPosition(openLeft, openTop)
            gsap.to(shell, {
                left: openLeft,
                top: openTop,
                width,
                height,
                padding,
                duration: 0.3,
                ease: 'power2.out',
            })
        }
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
    }, [isOpen, isAnimating, getAnchorPos, setOpenPosition])

    /* ── drag to dismiss ── */
    useEffect(() => {
        if (!isOpen || isAnimating) {
            killDraggable()
            return
        }

        const shell = shellRef.current
        const modal = modalRef.current
        if (!shell || !modal) return

        const [draggable] = Draggable.create(shell, {
            type: 'left,top',
            trigger: modal,
            dragClickables: false,
            minimumMovement: 6,
            zIndexBoost: false,
            onPress() {
                dragStateRef.current.startLeft = getPixelValue(shell, 'left')
                dragStateRef.current.startTop = getPixelValue(shell, 'top')
                dragStateRef.current.dx = 0
                dragStateRef.current.dy = 0
                gsap.set(shell, { cursor: 'grabbing' })
                gsap.to(shell, {
                    scale: DRAG_GRAB_SCALE,
                    duration: 0.16,
                    ease: 'power2.out',
                    overwrite: 'auto',
                })
            },
            onDrag() {
                const currentLeft = getPixelValue(shell, 'left')
                const currentTop = getPixelValue(shell, 'top')
                const dx = currentLeft - dragStateRef.current.startLeft
                const dy = currentTop - dragStateRef.current.startTop
                dragStateRef.current.dx = dx
                dragStateRef.current.dy = dy
                updateDragFeedback(dx, dy)
            },
            onRelease() {
                if (!this.isDragging) {
                    gsap.set(shell, { cursor: 'grab' })
                    gsap.to(shell, {
                        scale: 1,
                        duration: 0.18,
                        ease: 'power2.out',
                        overwrite: 'auto',
                    })
                }
            },
            onDragEnd() {
                gsap.set(shell, { cursor: 'grab' })

                const { dx, dy } = dragStateRef.current
                const progress = getDragCloseProgress(dx, dy)

                if (progress >= 1) {
                    close(true)
                    return
                }

                resetDragPosition(true)
            },
        })

        draggableRef.current = draggable
        gsap.set(shell, { cursor: 'grab' })
        resetDragPosition()

        return () => {
            if (draggableRef.current === draggable) {
                draggableRef.current = null
            }
            draggable.kill()
            gsap.set(shell, { clearProps: 'cursor' })
        }
    }, [isOpen, isAnimating, close, killDraggable, resetDragPosition, updateDragFeedback])

    /* ──────── render ──────── */

    const portal = createPortal(
        <>
            {/* SVG filter for directional motion blur (scoped per instance) */}
            <MotionBlurSVG filterId={filterId} />

            {/* backdrop */}
            <button
                ref={backdropRef}
                type="button"
                aria-label="Cerrar"
                onClick={() => close()}
                className={`fixed inset-0 bg-slate-950/60 ${isOpen || isAnimating ? 'pointer-events-auto' : 'pointer-events-none'
                    }`}
                style={{
                    zIndex: 9998,
                    backdropFilter: 'blur(0px)',
                    WebkitBackdropFilter: 'blur(0px)',
                }}
            />

            {/* shell (portalled so it's always above backdrop) */}
            <section
                ref={shellRef}
                className="fixed overflow-hidden border border-white/15 bg-white/[0.07] backdrop-blur-2xl"
                style={{
                    zIndex: 9999,
                    transform: 'translateX(-50%)',
                    WebkitBackdropFilter: 'blur(40px)',
                }}
            >
                {/* glow */}
                <div
                    ref={glowRef}
                    className="pointer-events-none absolute inset-0 rounded-[inherit] bg-linear-to-br from-cyan-400/20 via-transparent to-blue-500/10"
                />

                <div
                    ref={contentRef}
                    className="relative h-full w-full"
                >
                    {/* pill (closed) — renders user-provided trigger or plain fallback */}
                    <div
                        ref={closedRef}
                        className="absolute inset-0"
                        aria-hidden={isOpen || isAnimating}
                    >
                        <div
                            role="button"
                            tabIndex={0}
                            onClick={() => { if (!isOpen && !isAnimating) open() }}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!isOpen && !isAnimating) open() } }}
                            style={{ cursor: isOpen || isAnimating ? 'default' : 'pointer', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' } as CSSProperties}
                        >
                            {trigger ?? (
                                <span className="text-sm font-semibold tracking-[0.18em] text-slate-100">
                                    {triggerLabel}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* expanded content */}
                    <div
                        ref={modalRef}
                        className="absolute inset-0 flex flex-col gap-6"
                        aria-hidden={!isOpen}
                        style={{ cursor: isOpen && !isAnimating ? 'grab' : 'default' }}
                    >
                        {/* built-in close header */}
                        <div className="flex items-center justify-between">
                            <p className="text-xs uppercase tracking-[0.2em] text-cyan-200/85">
                                Dynamic Island
                            </p>
                            <button
                                type="button"
                                onClick={() => close()}
                                className="rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-slate-200 transition-colors duration-200 hover:bg-white/20"
                            >
                                Cerrar
                            </button>
                        </div>

                        {/* consumer content */}
                        {children}
                    </div>
                </div>
            </section>
        </>,
        document.body,
    )

    return (
        <>
            {portal}

            {/* anchor — reserves space in flow and provides position reference.
                Its size is dictated by the trigger content, not fixed constants. */}
            <div
                ref={anchorRef}
                className="inline-flex"
            >
                {/* invisible copy of trigger to measure natural size */}
                <div style={{ visibility: 'hidden', pointerEvents: 'none' } as CSSProperties}>
                    {trigger ?? (
                        <span className="text-sm font-semibold tracking-[0.18em]">
                            {triggerLabel}
                        </span>
                    )}
                </div>
            </div>
        </>
    )
}
