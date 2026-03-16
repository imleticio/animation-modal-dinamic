import { gsap } from 'gsap'
import { Flip } from 'gsap/dist/Flip'

gsap.registerPlugin(Flip)
import {
    useCallback,
    useEffect,
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
const CLOSED_RADIUS = 999
const CLOSED_PADDING = 8
const OPEN_RADIUS = 44
const VIEWPORT_MARGIN = 16

/* ── easings ── */
const SPRING_OUT = 'elastic.out(1, 0.72)'
const BLUR_EASE = 'power2.inOut'

function clamp(v: number, lo: number, hi: number) {
    return Math.min(Math.max(v, lo), hi)
}

function getOpenMetrics() {
    const width = Math.min(window.innerWidth * 0.92, 430)
    const height = clamp(window.innerHeight * 0.72, 360, 500)
    const padding = window.innerWidth < 640 ? 16 : 22
    return { width, height, padding }
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

export default function DynamicIsland({
    trigger,
    triggerLabel = 'ABRIR',
    children,
}: DynamicIslandProps) {
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

    /* measured dimensions of the anchor (trigger content) */
    const [anchorW, setAnchorW] = useState(DEFAULT_CLOSED_WIDTH)
    const [anchorH, setAnchorH] = useState(DEFAULT_CLOSED_HEIGHT)

    const killTl = useCallback(() => {
        tlRef.current?.kill()
        tlRef.current = null
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

    /* ── measure anchor size via ResizeObserver ── */
    useEffect(() => {
        const anchor = anchorRef.current
        if (!anchor) return
        const ro = new ResizeObserver(([entry]) => {
            const { width, height } = entry.contentRect
            if (width > 0) setAnchorW(width)
            if (height > 0) setAnchorH(height)
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
            borderRadius: CLOSED_RADIUS,
            padding: CLOSED_PADDING,
            boxShadow: '0 4px 24px -6px rgba(0,0,0,0.45)',
        })
        gsap.set(backdrop, { autoAlpha: 0, backdropFilter: 'blur(0px)' })
        gsap.set(closed, { autoAlpha: 1, scale: 1, filter: 'blur(0px)' })
        gsap.set(modal, { autoAlpha: 0, y: 24, scale: 0.92, filter: 'blur(12px)' })
        gsap.set(content, { filter: 'blur(0px)' })
        if (glow) gsap.set(glow, { autoAlpha: 0, scale: 0.8 })

        return () => killTl()
    }, [killTl, snapShellToAnchor, anchorW, anchorH])

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

        if (modal) modal.style.overflowY = 'hidden'

        const tl = gsap.timeline({
            onComplete: () => {
                setIsAnimating(false)
                if (modal) modal.style.overflowY = 'auto'
            },
        })
        tlRef.current = tl

        /* closed content dissolves */
        tl.to(closed, {
            autoAlpha: 0, scale: 0.75, filter: 'blur(8px)',
            duration: 0.22, ease: 'power2.in',
        }, 0)

        /* backdrop */
        tl.to(backdrop, {
            autoAlpha: 1, backdropFilter: 'blur(22px)',
            duration: 0.55, ease: BLUR_EASE,
        }, 0)

        /* ── FLIP: shell morph (GPU-accelerated) ── */
        const flipState = Flip.getState(shell, "borderRadius,padding")
        shell.style.left = `${openLeft}px`
        shell.style.top = `${openTop}px`
        shell.style.width = `${width}px`
        shell.style.height = `${height}px`
        shell.style.borderRadius = `${OPEN_RADIUS}px`
        shell.style.padding = `${padding}px`

        const flipTl = Flip.from(flipState, {
            duration: 0.88,
            ease: SPRING_OUT,
            absolute: true,
            immediateRender: true
        })
        tl.add(flipTl, 0.02)

        /* shadow bloom */
        tl.to(shell, {
            boxShadow: '0 40px 120px -20px rgba(0,0,0,0.9), 0 0 60px -10px rgba(34,211,238,0.15)',
            duration: 0.6, ease: 'power2.out',
        }, 0.08)

        /* glow pulse */
        if (glow) {
            tl.to(glow, { autoAlpha: 0.6, scale: 1, duration: 0.6, ease: 'power2.out' }, 0.1)
            tl.to(glow, { autoAlpha: 0.25, duration: 0.5, ease: 'power1.inOut' }, 0.7)
        }

        /* modal frosted-glass reveal */
        gsap.set(modal, { filter: 'blur(12px)' })
        tl.to(modal, {
            autoAlpha: 1, y: 0, scale: 1, filter: 'blur(0px)',
            duration: 0.7, ease: SPRING_OUT,
        }, 0.22)
    }, [isAnimating, isOpen, killTl, snapShellToAnchor, getAnchorPos])

    /* ── CLOSE ── */
    const close = useCallback(() => {
        if (isAnimating || !isOpen) return

        const shell = shellRef.current
        const backdrop = backdropRef.current
        const closed = closedRef.current
        const modal = modalRef.current
        const content = contentRef.current
        const glow = glowRef.current

        if (!shell || !backdrop || !closed || !modal || !content) return

        const { centerX, topY } = getAnchorPos()
        const settleW = Math.max(anchorW - 6, anchorW * 0.96)
        const settleH = Math.max(anchorH - 4, anchorH * 0.96)
        const settlePad = Math.max(CLOSED_PADDING - 0.5, 6)

        setIsAnimating(true)
        killTl()
        if (modal) modal.style.overflowY = 'hidden'
        gsap.set(shell, { willChange: 'left,top,width,height,border-radius,padding,box-shadow,transform' })
        gsap.set(modal, { willChange: 'transform,opacity,filter' })
        gsap.set(content, { willChange: 'filter' })
        gsap.set(backdrop, { willChange: 'opacity' })

        const tl = gsap.timeline({
            onComplete: () => {
                setIsOpen(false)
                setIsAnimating(false)
                snapShellToAnchor()
                gsap.set(content, { filter: 'blur(0px)' })
                gsap.set([shell, modal, content, backdrop], { clearProps: 'willChange' })
            },
        })
        tlRef.current = tl

        /* modal content exits quickly, with a clipped defocus instead of blurring the shell outline */
        tl.to(modal, {
            autoAlpha: 0, y: -4, scale: 0.985, filter: 'blur(6px)',
            duration: 0.16, ease: 'power3.in',
        }, 0)
        tl.to(content, {
            filter: 'blur(5px)',
            duration: 0.12,
            ease: 'power2.in',
        }, 0.02)
        tl.to(content, {
            filter: 'blur(0px)',
            duration: 0.16,
            ease: 'power1.out',
        }, 0.18)

        /* glow out */
        if (glow) {
            tl.to(glow, { autoAlpha: 0, scale: 0.88, duration: 0.24, ease: 'power2.in' }, 0.02)
        }

        /* backdrop fades while shell collapses */
        tl.to(backdrop, {
            autoAlpha: 0,
            duration: 0.22, ease: 'power2.out',
        }, 0)
        tl.set(backdrop, { backdropFilter: 'blur(0px)' }, '>')

        /* shell collapse in 2 phases: direct compression + subtle settle, no visible bounce */
        tl.to(shell, {
            left: centerX,
            top: topY + 1,
            width: settleW,
            height: settleH,
            borderRadius: CLOSED_RADIUS,
            padding: settlePad,
            duration: 0.26,
            ease: 'power3.in',
        }, 0.02)
        tl.to(shell, {
            top: topY,
            width: anchorW,
            height: anchorH,
            padding: CLOSED_PADDING,
            duration: 0.14,
            ease: 'power2.out',
        }, 0.28)

        /* shadow collapse */
        tl.to(shell, {
            boxShadow: '0 4px 24px -6px rgba(0,0,0,0.45)',
            duration: 0.28, ease: 'power2.inOut',
        }, 0.04)

        /* closed pill returns near the end */
        tl.fromTo(closed, {
            autoAlpha: 0, scale: 0.985, y: 2, filter: 'blur(3px)',
        }, {
            autoAlpha: 1, scale: 1, y: 0, filter: 'blur(0px)',
            duration: 0.18, ease: 'power2.out',
        }, 0.26)
    }, [isAnimating, isOpen, killTl, getAnchorPos, snapShellToAnchor, anchorW, anchorH])

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
            gsap.to(shell, { left: openLeft, top: openTop, width, height, padding, duration: 0.3, ease: 'power2.out' })
        }
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
    }, [isOpen, isAnimating, getAnchorPos])

    /* ──────── render ──────── */

    const portal = createPortal(
        <>
            {/* backdrop */}
            <button
                ref={backdropRef}
                type="button"
                aria-label="Cerrar"
                onClick={close}
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
                className="fixed overflow-hidden border border-white/15 bg-white/[0.07] backdrop-blur-2xl will-change-[width,height,border-radius,padding,box-shadow,left,top]"
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
                    >
                        {/* built-in close header */}
                        <div className="flex items-center justify-between">
                            <p className="text-xs uppercase tracking-[0.2em] text-cyan-200/85">
                                Dynamic Island
                            </p>
                            <button
                                type="button"
                                onClick={close}
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
