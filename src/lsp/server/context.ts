import { ContextSnapshot } from '../protocol'

let ctx: ContextSnapshot | null = null

export function setContext(snapshot: ContextSnapshot) {
  ctx = snapshot
}

export function getContext(): ContextSnapshot | null {
  return ctx
}