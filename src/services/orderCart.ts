/** Transient checkout selection shared between the product list and checkout. */
let selectedQuantities: Record<string, number> = {};

export const orderCart = {
  set(quantities: Record<string, number>) {
    selectedQuantities = { ...quantities };
  },
  get() {
    return { ...selectedQuantities };
  },
  clear() {
    selectedQuantities = {};
  },
};
