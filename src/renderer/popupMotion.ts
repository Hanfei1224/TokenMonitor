import { useEffect, useState } from 'react'

export const popupInitial = { opacity: 0, scale: 0.9, y: -16 }
export const popupAnimate = { opacity: 1, scale: 1, y: 0 }
export const popupSpring = { type: 'spring' as const, damping: 22, stiffness: 280 }

export function usePopupEnter() {
  const [enter, setEnter] = useState(false)

  useEffect(() => {
    const id = requestAnimationFrame(() => setEnter(true))
    return () => cancelAnimationFrame(id)
  }, [])

  return enter
}
