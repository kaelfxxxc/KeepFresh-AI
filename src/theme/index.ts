// Re-export of the design system.
//
// The tokens themselves live in `theme/index.ts` at the repo root — that file
// is the single source of truth. This module exists so the many files that
// import from `src/theme` keep working; both paths resolve to the same objects,
// so there is only ever one copy of each token.
export * from '../../theme';
export { default } from '../../theme';
