/** Transient checkout selection shared between the product list and checkout. */
let selectedQuantities: Record<string, number> = {};
export type DraftOrderItem = {
  key: string;
  product_name: string;
  brand: string | null;
  category: string | null;
  barcode: string | null;
  quantity: number;
  unit: string;
  expiration_date: string | null;
  image_url: string | null;
  price: number;
};
let draftItems: DraftOrderItem[] = [];

export const orderCart = {
  set(quantities: Record<string, number>) {
    selectedQuantities = { ...quantities };
  },
  get() {
    return { ...selectedQuantities };
  },
  addDraft(item: Omit<DraftOrderItem, 'key'>) {
    const key = `scan:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    draftItems = [...draftItems, { ...item, key }];
    return key;
  },
  getDrafts() {
    return draftItems.map((item) => ({ ...item }));
  },
  setDrafts(items: DraftOrderItem[]) {
    draftItems = items.map((item) => ({ ...item }));
  },
  clear() {
    selectedQuantities = {};
    draftItems = [];
  },
};
