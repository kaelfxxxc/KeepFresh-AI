// Price tracking — what your groceries cost, and how that changes.
//
// The history itself is collected by a database trigger whenever an item's
// price changes, so nothing is lost while a plan is on Free Trial; the read is
// gated by the `price_tracking` entitlement, which is why upgrading reveals
// history that was already being recorded.
//
// Everything on the screen comes from one `overview()` read, so the summary
// card and the product list below it are always two views of the same ledger.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Pressable,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Plus,
  Tag,
  SearchX,
  Check,
  ChevronDown,
  LayoutGrid,
} from 'lucide-react-native';
import type { LucideProps } from 'lucide-react-native';
import { useAuth } from '../src/context/AuthContext';
import { useSubscription } from '../src/context/SubscriptionContext';
import { colors, radii, spacing, shadow, overlay } from '../theme';
import { NavHeader, Card, PillButton, Field, EmptyState, StatusBadge, FeatureLock, PlanCheckLock, SectionLabel, StatCard, FilterChipRow, StatusPill, IconBadge, colorWithOpacity } from '../src/components/ui';
import { PriceLineChart } from '../src/components/PriceLineChart';
import {
  priceTrackingService,
  type PriceMovement,
  type ProductPriceSummary,
  type SpendSummary,
} from '../src/services/priceTrackingService';
import { categoryIcon, categoryLabel, resolveCategory, type CategoryKey } from '../src/utils/categoryIcons';
import { timeAgo } from '../src/utils/timeAgo';
import { useContentLayout } from '../src/hooks/useContentLayout';

/** Cents on a product row, where the figure is being compared to a shelf tag. */
const peso = (n: number) =>
  `₱${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** No cents on the headline, which is a total rather than a price. */
const pesoCompact = (n: number) => `₱${Math.round(Number(n)).toLocaleString()}`;

/**
 * Percentage change between two windows, to one decimal.
 *
 * Returns null rather than 0 when there is no baseline to divide by: "0%
 * change" and "we have nothing to compare against" are different statements,
 * and only one of them is true on a first month of use.
 */
function percentChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

type Range = 'month' | 'sixMonths';
type Filter = 'all' | CategoryKey;

/** Same shape the shared kit and the category resolver use for an icon. */
type IconComp = React.ComponentType<LucideProps>;

export default function PriceTrackingScreen() {
  const { profile } = useAuth();
  const { gates, entitlements, loading: planLoading, error: planError, refresh: refreshPlan } = useSubscription();
  const insets = useSafeAreaInsets();
  // Caps the content column and centres it, the same way Inventory and the Add
  // Item form do — so a tablet or a landscape phone gets a readable column
  // rather than cards stretched the full width of the display.
  const { contentWidth, gutter } = useContentLayout();

  /**
   * How wide the filter button may grow.
   *
   * It shares one row with the search field, so a flat cap that suits a 390pt
   * phone leaves the field too narrow to read its own placeholder on a 320pt
   * one. Taking a share of the column instead keeps the two in proportion at
   * every size, and the floor stops the label shrinking to an ellipsis.
   */
  const filterCap = Math.max(104, Math.min(148, Math.round(contentWidth * 0.42)));

  const [products, setProducts] = useState<ProductPriceSummary[]>([]);
  const [spend, setSpend] = useState<SpendSummary | null>(null);
  const [movement, setMovement] = useState<PriceMovement | null>(null);
  const [range, setRange] = useState<Range>('month');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [logging, setLogging] = useState(false);

  const canView = gates.priceTracking.allowed;

  const load = useCallback(async () => {
    if (!profile || !canView) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const next = await priceTrackingService.overview(profile.id);
      setProducts(next.products);
      setSpend(next.spend);
      setMovement(next.movement);
    } catch (e) {
      Alert.alert('Could not load prices', (e as Error)?.message ?? 'Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [profile, canView]);

  useEffect(() => { load(); }, [load]);

  /**
   * The categories actually present in the user's own ledger.
   *
   * Read off the data rather than from the full category list: a filter row
   * offering eleven categories when the shop has bought three of them is
   * eleven targets to rule out. Counts come from the unfiltered set so a chip
   * never advertises a number the search has already excluded.
   */
  const categories = useMemo(() => {
    const counts = new Map<CategoryKey, number>();
    products.forEach((p) => {
      const key = resolveCategory(p.category);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [products]);

  const query = search.trim().toLowerCase();

  /**
   * The filter actually in force, which is not always the one stored.
   *
   * A category can leave the ledger — its last product deleted, or the search
   * narrowed to nothing — and a stored filter naming a category that is no
   * longer offered would hide every row with no way back to them, because the
   * control that clears it lists categories and no longer lists that one.
   * Deriving the effective filter means the same condition also releases it.
   */
  const showFilter = categories.length > 1;
  const activeFilter: Filter =
    showFilter && filter !== 'all' && categories.some(([key]) => key === filter) ? filter : 'all';

  const visible = useMemo(
    () =>
      products.filter((p) => {
        if (activeFilter !== 'all' && resolveCategory(p.category) !== activeFilter) return false;
        if (!query) return true;
        return (
          p.productName.toLowerCase().includes(query) ||
          (p.barcode ?? '').toLowerCase().includes(query)
        );
      }),
    [products, activeFilter, query]
  );

  // Switching to a filter that the current search has emptied is not a dead
  // end worth guarding — the filter button stays visible, so the way back is
  // on screen.
  const filtering = activeFilter !== 'all' || query.length > 0;

  // No entitlements means we cannot tell whether this page is allowed: `gates`
  // reports every feature as allowed until it has a snapshot to read, so falling
  // through to the content would show a lapsed account the very page its plan
  // does not include. Say the plan is still unknown rather than guess either way.
  if (!entitlements) {
    return (
      <View style={styles.container}>
        <NavHeader title="Price Tracking" subtitle="Know what your groceries cost" />
        <PlanCheckLock loading={planLoading} error={planError} onRetry={refreshPlan} />
      </View>
    );
  }

  if (!canView) {
    return (
      <View style={styles.container}>
        <NavHeader title="Price Tracking" subtitle="Know what your groceries cost" />
        <FeatureLock
          icon={Tag}
          title="Price tracking is a Premium feature"
          message="Follow what each product costs over time, see when a price changes, and know what a basket really costs you."
          bullets={[
            'Current price versus the last price you paid',
            'Full price history for every product',
            'Monthly grocery spend',
            'Price-change alerts as they happen',
          ]}
          ctaLabel="See plans"
          onPress={() => router.push('/subscription')}
        />
      </View>
    );
  }

  const headline = range === 'month'
    ? {
        value: spend?.thisMonth ?? 0,
        change: percentChange(spend?.thisMonth ?? 0, spend?.lastMonth ?? 0),
        comparison: 'vs last month',
      }
    : {
        value: spend?.window ?? 0,
        change: percentChange(spend?.window ?? 0, spend?.priorWindow ?? 0),
        comparison: 'vs previous 6 months',
      };

  // Null when there is no baseline to compare against: an absent badge says
  // "not known yet", where "0%" would claim a measurement nobody made.
  const delta = headline.change == null ? null : (
    <StatusBadge
      tone={headline.change > 0 ? 'danger' : headline.change < 0 ? 'success' : 'neutral'}
      icon={headline.change > 0 ? TrendingUp : headline.change < 0 ? TrendingDown : Minus}
      label={
        headline.change === 0
          ? `No change ${headline.comparison}`
          : `${Math.abs(headline.change)}% ${headline.comparison}`
      }
      style={styles.summaryDelta}
    />
  );

  return (
    <View style={styles.container}>
      <NavHeader title="Price Tracking" subtitle="Know what your groceries cost" />

      <ScrollView
        contentContainerStyle={[
          styles.scrollBody,
          // The FAB floats over the content, so the last row has to stop above
          // it rather than underneath it.
          { paddingHorizontal: gutter, paddingBottom: insets.bottom + 96 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
      >
        <FilterChipRow
          chips={[
            { label: 'This month', count: undefined },
            { label: 'Last 6 months', count: undefined },
          ]}
          activeChip={range === 'month' ? 'This month' : 'Last 6 months'}
          onSelect={(label) => setRange(label === 'This month' ? 'month' : 'sixMonths')}
          style={{ marginBottom: spacing.md }}
        />

        {loading ? (
          <View style={styles.loadingBox}><ActivityIndicator color={colors.primary} /></View>
        ) : (
          <>
            {spend && (
              <View style={{ marginBottom: spacing.md, gap: spacing.md }}>
                <View style={{ flexDirection: 'row', gap: spacing.md }}>
                  <StatCard
                    icon={TrendingUp}
                    title="Monthly spend"
                    value={pesoCompact(headline.value)}
                    caption={headline.comparison}
                    iconBg={colors.primary}
                    style={{ flex: 1 }}
                  />
                  <StatCard
                    icon={Tag}
                    title="Tracked items"
                    value={String(products.length)}
                    caption="Active in ledger"
                    iconBg={colors.mintBg}
                    style={{ flex: 1 }}
                  />
                </View>

                <Card style={styles.summaryCard}>
                  <Text style={styles.summaryLabel}>Total tracked spend & movement</Text>

                  <View style={styles.summaryHead}>
                    <Text
                      style={styles.summaryValue}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      maxFontSizeMultiplier={1.4}
                      minimumFontScale={0.7}
                    >
                      {pesoCompact(headline.value)}
                    </Text>
                    {delta}
                  </View>

                  <View style={styles.movementRow}>
                    {movement != null && movement.up.count > 0 && (
                      <StatusPill
                        status="expired"
                        label={`${movement.up.avgPercent}% avg · ${movement.up.count} up`}
                      />
                    )}
                    {movement != null && movement.down.count > 0 && (
                      <StatusPill
                        status="fresh"
                        label={`${movement.down.avgPercent}% avg · ${movement.down.count} down`}
                      />
                    )}
                    {movement != null && movement.up.count + movement.down.count === 0 && (
                      <Text style={styles.movementNote}>
                        No price changes in the last 30 days
                      </Text>
                    )}
                  </View>

                  <PriceLineChart data={spend.trend} formatValue={pesoCompact} />
                </Card>
              </View>
            )}

            <SectionLabel>Your products</SectionLabel>

            {products.length > 0 && (
              <>
                {/* Search and filter on one row. They were stacked before, with
                    the filter as a wrapping strip of chips below — which spent
                    a whole band of the card on a control most visits never
                    touch, and left the search field a third narrower than the
                    space it had. */}
                <View style={styles.searchRow}>
                  <View style={styles.searchBox}>
                    <TextInput
                      style={styles.searchInput}
                      value={search}
                      onChangeText={setSearch}
                      placeholder="Search products"
                      placeholderTextColor={colors.textSecondary}
                      returnKeyType="search"
                      autoCorrect={false}
                      // Both this box and the filter button beside it are a
                      // fixed 46pt tall, so unbounded accessibility scaling
                      // would clip the text inside them rather than grow them.
                      maxFontSizeMultiplier={1.4}
                    />
                  </View>

                  {/* Hidden when the ledger holds a single category: a picker
                      whose only options are "All" and the one category is not a
                      filter. */}
                  {showFilter && (
                    <Pressable
                      onPress={() => setFilterOpen(true)}
                      android_ripple={{ color: 'transparent' }}
                      style={({ pressed }) => [
                        styles.filterBtn,
                        { maxWidth: filterCap },
                        activeFilter !== 'all' && styles.filterBtnActive,
                        pressed && { opacity: 0.85 },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={
                        activeFilter === 'all'
                          ? 'Filter by category, showing all'
                          : `Filter by category, showing ${categoryLabel(activeFilter)}`
                      }
                    >
                      <Text
                        style={[
                          styles.filterBtnText,
                          activeFilter !== 'all' && styles.filterBtnTextActive,
                        ]}
                        numberOfLines={1}
                        maxFontSizeMultiplier={1.4}
                      >
                        {activeFilter === 'all' ? 'All' : categoryLabel(activeFilter)}
                      </Text>
                      <ChevronDown
                        size={16}
                        color={activeFilter !== 'all' ? colors.primary : colors.textSecondary}
                        strokeWidth={2.4}
                      />
                    </Pressable>
                  )}
                </View>
              </>
            )}

            {products.length === 0 ? (
              <EmptyState
                icon={Tag}
                title="No prices recorded yet"
                hint="Prices are captured automatically when you add or edit an item's price, or log one below."
                actionLabel="Log a price"
                onAction={() => setLogging(true)}
              />
            ) : visible.length === 0 ? (
              <EmptyState
                icon={SearchX}
                title="No matching products"
                hint="Nothing in your history matches that search and filter."
                actionLabel="Clear filters"
                onAction={() => { setSearch(''); setFilter('all'); }}
                compact
              />
            ) : (
              <View style={styles.productList}>
                {visible.map((product) => (
                  <ProductCard key={product.productName} product={product} />
                ))}
              </View>
            )}

            {!filtering && products.length > 0 && (
              <Text style={styles.footnote}>
                Price history is recorded automatically whenever an item's price changes, including
                changes made by a teammate.
              </Text>
            )}
          </>
        )}
      </ScrollView>

      <Pressable
        onPress={() => setLogging(true)}
        android_ripple={{ color: 'transparent' }}
        style={({ pressed }) => [
          styles.fab,
          // `right: gutter` rather than a fixed margin, so the button tracks
          // the right edge of the content column instead of drifting away from
          // it on a wide screen.
          { bottom: insets.bottom + spacing.md, right: gutter },
          pressed && { opacity: 0.9 },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Add a price"
      >
        <Plus size={18} color={colors.surface} strokeWidth={2.8} />
        <Text style={styles.fabText} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          Add price
        </Text>
      </Pressable>

      <CategoryFilterModal
        visible={filterOpen}
        options={categories}
        value={activeFilter}
        onSelect={setFilter}
        onClose={() => setFilterOpen(false)}
      />

      <LogPriceModal
        visible={logging}
        onClose={() => setLogging(false)}
        onSaved={async () => { setLogging(false); await load(); }}
      />
    </View>
  );
}

/* -------------------------------------------------------------- product card */

function ProductCard({ product }: { product: ProductPriceSummary }) {
  const rising = product.change > 0;
  const falling = product.change < 0;
  const pillStatus = rising ? 'expired' : falling ? 'fresh' : 'active';
  const Icon = categoryIcon(product.category);

  const changeLabel = rising
    ? `HIGH +${product.changePercent}%`
    : falling
      ? `LOW −${Math.abs(product.changePercent)}%`
      : 'STABLE';

  const updated = timeAgo(product.lastRecordedAt);

  return (
    <Card style={styles.productCard}>
      <View style={styles.productTop}>
        <IconBadge color={colors.primary} size={40}>
          <Icon size={20} color={colors.primary} strokeWidth={2.2} />
        </IconBadge>

        <View style={styles.productMiddle}>
          <Text style={styles.productName} numberOfLines={1}>{product.productName}</Text>
          <Text style={styles.productMeta} numberOfLines={1}>
            {updated ? `Updated ${updated}` : `${product.observations} records`}
          </Text>
        </View>

        <View style={styles.productRight}>
          <Text style={styles.currentPrice} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            {peso(product.currentPrice)}
          </Text>
          {product.previousPrice != null && (
            <StatusPill status={pillStatus} label={changeLabel} />
          )}
        </View>
      </View>
    </Card>
  );
}

/* --------------------------------------------------------- category filter */

/**
 * The category picker behind the filter button.
 *
 * A scrolling list rather than the shared `ActionMenu`, for two reasons the
 * menu cannot cover: a ledger can hold all eleven categories, which is more
 * rows than a centred card fits on a small screen, and a filter has to show
 * which option is currently in force — the menu's rows have no selected state.
 */
function CategoryFilterModal({
  visible,
  options,
  value,
  onSelect,
  onClose,
}: {
  visible: boolean;
  options: [CategoryKey, number][];
  value: Filter;
  onSelect: (f: Filter) => void;
  onClose: () => void;
}) {
  const choose = (next: Filter) => {
    onSelect(next);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.filterSheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.sheetTitle}>Filter by category</Text>

          <ScrollView style={styles.filterList} bounces={false}>
            <FilterRow
              icon={LayoutGrid}
              label="All"
              count={options.reduce((total, [, n]) => total + n, 0)}
              active={value === 'all'}
              onPress={() => choose('all')}
            />
            {options.map(([key, count]) => (
              <FilterRow
                key={key}
                icon={categoryIcon(key)}
                label={categoryLabel(key)}
                count={count}
                active={value === key}
                onPress={() => choose(key)}
              />
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function FilterRow({
  icon: Icon,
  label,
  count,
  active,
  onPress,
}: {
  icon: IconComp;
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [styles.filterRow, pressed && { backgroundColor: colorWithOpacity(colors.textSecondary, 0.12) }]}
    >
      <View style={[styles.filterRowIcon, active && styles.filterRowIconActive]}>
        <Icon size={18} color={active ? colors.primary : colors.textSecondary} strokeWidth={2} />
      </View>
      <Text
        style={[styles.filterRowLabel, active && styles.filterRowLabelActive]}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Text style={styles.filterRowCount}>{count}</Text>
      {/* The tick is the selection, not the colour: the active row is also
          tinted, but tint alone is not something a reader can rely on. */}
      {active && <Check size={18} color={colors.primary} strokeWidth={2.6} />}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ log price */

function LogPriceModal({
  visible,
  onClose,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { profile } = useAuth();
  const [productName, setProductName] = useState('');
  const [price, setPrice] = useState('');
  const [supplier, setSupplier] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setProductName('');
    setPrice('');
    setSupplier('');
    setError(null);
  }, [visible]);

  const save = async () => {
    if (!profile) return;
    const name = productName.trim();
    const value = parseFloat(price.replace(',', '.'));

    if (!name) {
      setError('Which product is this?');
      return;
    }
    if (!Number.isFinite(value) || value < 0) {
      setError('Enter a valid price.');
      return;
    }

    setBusy(true);
    try {
      await priceTrackingService.recordPrice(profile.id, {
        productName: name,
        price: value,
        supplier: supplier.trim() || null,
      });
      await onSaved();
    } catch (e) {
      setError((e as Error)?.message ?? 'Could not save this price.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.backdrop} onPress={busy ? undefined : onClose}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>Log a price</Text>
            <Text style={styles.sheetHint}>
              For something you saw at the till that isn't in your inventory yet.
            </Text>

            <Field
              label="Product"
              value={productName}
              onChangeText={(t) => { setProductName(t); if (error) setError(null); }}
              placeholder="e.g. Cooking Oil 1L"
              autoFocus
              editable={!busy}
            />
            <Field
              label="Price (₱)"
              value={price}
              onChangeText={(t) => { setPrice(t); if (error) setError(null); }}
              placeholder="0.00"
              keyboardType="decimal-pad"
              editable={!busy}
            />
            <Field
              label="Store (optional)"
              value={supplier}
              onChangeText={setSupplier}
              placeholder="Where you saw it"
              editable={!busy}
            />

            {!!error && <Text style={styles.sheetError}>{error}</Text>}

            <View style={styles.sheetActions}>
              <PillButton title="Cancel" variant="outline" onPress={onClose} disabled={busy} style={{ flex: 1 }} />
              <PillButton title="Save" onPress={save} loading={busy} style={{ flex: 1 }} />
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.screenBg },
  // Horizontal padding and the bottom inset are applied at the call site: the
  // first comes from the device width, the second from the safe area.
  scrollBody: { paddingTop: spacing.lg },
  loadingBox: { paddingVertical: spacing.xxl, alignItems: 'center' },

  /* Summary */
  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  summaryLabel: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  summaryHead: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: 2,
  },
  // The one figure the screen leads with, so it is set well clear of
  // everything else on the card. `flexShrink` lets it give way to the badge
  // beside it instead of pushing it off the edge.
  summaryValue: { fontSize: 34, fontWeight: '800', color: colors.textPrimary, flexShrink: 1 },
  // StatusBadge aligns itself to the start of its line (`alignSelf:
  // 'flex-start'` in the shared kit), which on a row it shares with a 34pt
  // number pins it to the top of the line box rather than against the figure.
  summaryDelta: { alignSelf: 'center' },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  // Wraps rather than squeezing: two badges side by side are wide, and on a
  // 320pt phone the second drops to its own line instead of truncating.
  movementRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  // Quiet, and below the badges rather than inside them: the label has to say
  // which window the figures cover, but it is not itself a figure. The toggle
  // above switches the chart between one month and six, so leaving this
  // unstated would invite reading "3 up" as belonging to whichever range is
  // selected.
  movementNote: { fontSize: 11.5, color: colors.textSecondary, marginTop: spacing.sm },

  /* Search & filter */
  // The bottom margin is the gap the chip band used to provide between the
  // search field and the first product card.
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    height: 46,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.textPrimary, padding: 0 },
  // Sized to its own label up to a cap that comes from the device width. Left
  // to itself "Canned & Packaged" would claim most of the row and squeeze the
  // search field beside it, so the cap holds and the label truncates instead.
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 46,
    paddingHorizontal: 14,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  // Tinted, not just emboldened: an active filter has to be legible as one at a
  // glance, because the list beneath it is otherwise unexplainably short.
  filterBtnActive: { backgroundColor: colors.mintBg, borderColor: colors.primary },
  filterBtnText: { flexShrink: 1, fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  filterBtnTextActive: { color: colors.primary, fontWeight: '700' },

  productList: { gap: spacing.md },

  /* Product card */
  productCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  productTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  productMiddle: { flex: 1, minWidth: 0 },
  productName: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  productMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  // Capped as a share of the row rather than pinned to a fixed width: left
  // unbounded, a large accessibility font grows this column until the product
  // name beside it has nothing left, and `adjustsFontSizeToFit` on the price
  // cannot engage until the text it is shrinking has a width to shrink into.
  // Right-aligned, so the prices still line up down the list whatever width
  // each card's column ends up at.
  productRight: { alignItems: 'flex-end', gap: 4, minWidth: 88, maxWidth: '50%' },
  // Tabular figures because these prices are read as a column: right-aligned
  // proportional digits put the decimal point of ₱60.00 and ₱1,450.00 at
  // different offsets, so the cents jitter down the list. The headline value is
  // deliberately left proportional — equal-width digits look loose at 34pt.
  currentPrice: { fontSize: 16, fontWeight: '800', color: colors.textPrimary, fontVariant: ['tabular-nums'] },


  footnote: { fontSize: 11.5, color: colors.textSecondary, lineHeight: 16, marginTop: spacing.lg },

  /* Floating action button */
  // The brand green, as the brief calls for — the primary action on the screen.
  fab: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    minHeight: 48,
    borderRadius: radii.pill,
    ...shadow.card,
  },
  fabText: { color: colors.surface, fontWeight: '700', fontSize: 14 },

  /* Category filter sheet */
  filterSheet: {
    width: '100%',
    maxWidth: 420,
    // Capped so the sheet never grows past the screen once every category is
    // listed; the ScrollView inside takes over from there.
    maxHeight: '70%',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  filterList: { marginTop: spacing.sm },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
  },
  filterRowIcon: {
    width: 34,
    height: 34,
    borderRadius: radii.sm,
    backgroundColor: colorWithOpacity(colors.textSecondary, 0.12),
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterRowIconActive: { backgroundColor: colors.mintBg },
  filterRowLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  filterRowLabelActive: { color: colors.primary, fontWeight: '700' },
  filterRowCount: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },

  /* Log price sheet */
  backdrop: {
    flex: 1, backgroundColor: overlay,
    alignItems: 'center', justifyContent: 'center', padding: spacing.lg,
  },
  sheet: { width: '100%', maxWidth: 420, backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  sheetHint: { fontSize: 12.5, color: colors.textSecondary, marginTop: 4, marginBottom: spacing.md, lineHeight: 17 },
  sheetError: { fontSize: 12, color: colors.danger, marginTop: spacing.sm },
  sheetActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
});
