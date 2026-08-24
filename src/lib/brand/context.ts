/**
 * The per-surface brand register, carried in Svelte context.
 *
 * WHY CONTEXT AND NOT A MODULE GLOBAL. "The same material" is one surface, so
 * the register has to be per page render, and on the server one module global
 * would be shared by every concurrent request. Context is per component tree,
 * which is exactly one surface, on both server and client.
 *
 * WHY THE CHECK RUNS LATE. A supporting mark may legitimately appear ABOVE
 * the full logo in the tree (a header lockup, a footer logo). If BrandLogo
 * asserted during its own init it would see an incomplete register and refuse
 * a legal usage. Every logo therefore REGISTERS during init and the assertion
 * runs in an effect, once the whole surface has registered. The refusal is
 * still the component's, and it still hides the mark.
 */
import { getContext, setContext } from 'svelte';
import { createRegister, type BrandRegister } from './rules';

const KEY = Symbol('brand-register');

export function provideBrandRegister(): BrandRegister {
	const register = createRegister();
	setContext(KEY, register);
	return register;
}

/**
 * The surface's register. A BrandLogo rendered with no BrandSurface above it
 * gets its own empty register, which means a supporting mark on such a page
 * is refused -- the safe direction, and a loud one.
 */
export function useBrandRegister(): BrandRegister {
	return getContext<BrandRegister>(KEY) ?? createRegister();
}

/**
 * FIRST-USE TRACKING for the names in running text. The guidelines want the
 * superscript registered symbol on the first use of each name in a document,
 * "both in heading/title and in body copy", and not afterwards. The counter
 * is per surface for the same reason the register is.
 */
const NAME_KEY = Symbol('brand-names');

export interface NameRegister {
	used: Set<string>;
}

export function provideNameRegister(): NameRegister {
	const reg: NameRegister = { used: new Set() };
	setContext(NAME_KEY, reg);
	return reg;
}

export function useNameRegister(): NameRegister {
	return getContext<NameRegister>(NAME_KEY) ?? { used: new Set() };
}

/**
 * Claims the first use of a name on this surface. Returns true exactly once
 * per name per surface, which is where the ® goes.
 */
export function claimFirstUse(reg: NameRegister, name: string): boolean {
	if (reg.used.has(name)) return false;
	reg.used.add(name);
	return true;
}
