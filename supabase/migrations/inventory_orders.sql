CREATE TABLE IF NOT EXISTS public.inventory_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  destination TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'placed' CHECK (status IN ('placed', 'fulfilled', 'cancelled')),
  subtotal NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0),
  total NUMERIC(12,2) NOT NULL CHECK (total >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.inventory_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.inventory_orders(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL,
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  line_total NUMERIC(12,2) NOT NULL CHECK (line_total >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_orders_user_created
  ON public.inventory_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_order_items_order
  ON public.inventory_order_items(order_id);

ALTER TABLE public.inventory_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own inventory orders" ON public.inventory_orders;
CREATE POLICY "Users can view own inventory orders" ON public.inventory_orders
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can create own inventory orders" ON public.inventory_orders;
CREATE POLICY "Users can create own inventory orders" ON public.inventory_orders
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own inventory order items" ON public.inventory_order_items;
CREATE POLICY "Users can view own inventory order items" ON public.inventory_order_items
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can create own inventory order items" ON public.inventory_order_items;
CREATE POLICY "Users can create own inventory order items" ON public.inventory_order_items
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.inventory_orders o
      WHERE o.id = order_id AND o.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.inventory_items i
      WHERE i.id = inventory_item_id AND i.user_id = auth.uid()
    )
  );
