import { createEngine } from '../engine/engine'

export type Eng = ReturnType<typeof createEngine>
export const IS_TOUCH = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
