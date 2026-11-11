import { useEffect, useState } from 'react'

// Narrower than this, the details open in a drawer as in the demo.
const WIDE = '(min-width: 1101px)'

/** True while the details fit as a third column; below that they open in a drawer. */
export function useWide() {
  const [wide, setWide] = useState(() => window.matchMedia?.(WIDE).matches ?? false)
  useEffect(() => {
    const query = window.matchMedia?.(WIDE)
    if (!query) return
    const update = () => setWide(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return wide
}
