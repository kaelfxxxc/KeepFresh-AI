// Price tracking — what your groceries cost, and how that changes.
//
// The history itself is collected by a database trigger whenever an item's
// price changes, so nothing is lost while a plan is on Free Trial; the read is
// gated by the `price_tracking` entitlement, which is why upgrading reveals
// history that was already being recorded.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Pressable,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { TrendingUp, TrendingDown, Minus, Plus, Tag, Receipt } from 'lucide-react-native';
import { useAuth } from '../src/context/AuthContext';
import { useSubscription } from '../src/context/SubscriptionContext';
import { COLORS, RADII, SPACING } from '../src/theme';
import {
  NavHeader,
  Card,
  PillButton,
  Field,
  EmptyState,
  StatusBadge,
  FeatureLock,
  SectionLabel,
} from '../src/components/ui';
import { priceTrackingService, type ProductPriceSummary } from '../src/services/priceTrackingService';

const peso = (n: number) =>
  `₱${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function PriceTrackingScreen() {
  const { profile } = useAuth();
  const { gates } = useSubscription();

  const [summaries, setSummaries] = useState<ProductPriceSummary[]>([]);
  const [spend, setSpend] = useState<{ label: string; value: number }[]>([]);
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
      const [nextSummaries, nextSpend] = await Promise.all([
        priceTrackingService.productSummaries(profile.id),
        priceTrackingService.monthlySpend(profile.id, 6),
      ]);
      setSummaries(nextSummaries);
      setSpend(nextSpend);
    } catch (e) {
      Alert.alert('Could not load prices', (e as Error)?.message ?? 'Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [profile, canView]);

  useEffect(() => { load(); }, [load]);

  if (!canView && !loading) {
    return (
      <View style={styles.container}>
        <NavHeader title="Price Tracking" subtitle="What your groceries cost" />
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

  const spendMax = Math.max(...spend.map((s) => s.value), 1);

  return (
    <View style={styles.container}>
      <NavHeader title="Price Tracking" subtitle="What your groceries cost" />
      <ScrollView
        contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            colors={[COLORS.primary]}
            tintColor={COLORS.primary}
          />
        }
      >
        {loading ? (
          <View style={styles.loadingBox}><ActivityIndicator color={COLORS.primary} /></View>
        ) : (
          <>
            {/* Monthly spend */}
            {spend.length > 0 && (
              <>
                <SectionLabel right={<Receipt size={15} color={COLORS.secondaryText} strokeWidth={2} />}>
                  Monthly spend
                </SectionLabel>
                <Card style={styles.spendCard}>
                  <View style={styles.spendRow}>
                    {spend.map((month) => (
                      <View key={month.label} style={styles.spendCol}>
                        <Text
                          style={styles.spendValue}
                          numberOfLines={1}
                          // Six months on a phone leaves each column narrow, and
                          // amounts are four or five digits. Shrinking the type
                          // when it has to beats the ellipsis that would
                          // otherwise hide the last digit — the one that matters.
                          adjustsFontSizeToFit
                          minimumFontScale={0.75}
                        >
                          {Math.round(month.value).toLocaleString()}
                        </Text>
                        <View style={styles.spendTrack}>
                          <View
                            style={[
                              styles.spendFill,
                              {
                                // A month with nothing spent gets no bar. The 4%
                                // floor exists so a small month stays visible
                                // beside a large one; applied to zero it drew a
                                // fixed stub for every empty month, which read as
                                // a placeholder rather than as a figure.
                                height: `${month.value > 0 ? Math.max((month.value / spendMax) * 100, 4) : 0}%`,
                              },
                            ]}
                          />
                        </View>
                        <Text style={styles.spendLabel}>{month.label}</Text>
                      </View>
                    ))}
                  </View>
                </Card>
              </>
            )}

            {summaries.length === 0 ? (
              <EmptyState
                icon={Tag}
                title="No prices recorded yet"
                hint="Prices are captured automatically when you add or edit an item's price, or log one below."
                actionLabel="Log a price"
                onAction={() => setLogging(true)}
              />
            ) : (
              <>
                <View style={{ height: SPACING.lg }} />
                <SectionLabel>Products</SectionLabel>
                <View style={{ gap: SPACING.sm }}>
                  {summaries.map((product) => (
                    <ProductCard key={product.productName} product={product} />
                  ))}
                </View>

                <PillButton
                  title="Log a price"
                  icon={Plus}
                  variant="outline"
                  onPress={() => setLogging(true)}
                  style={{ marginTop: SPACING.lg }}
                />
              </>
            )}

            <Text style={styles.footnote}>
              Price history is recorded automatically whenever an item's price changes, including
              changes made by a teammate.
            </Text>
          </>
        )}
      </ScrollView>

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
  const [expanded, setExpanded] = useState(false);

  const rising = product.change > 0;
  const falling = product.change < 0;
  const tone = rising ? 'danger' : falling ? 'success' : 'neutral';
  const ChangeIcon = rising ? TrendingUp : falling ? TrendingDown : Minus;

  const trendMax = Math.max(...product.trend.map((t) => t.value), 1);

  return (
    <Card style={styles.productCard}>
      <Pressable onPress={() => setExpanded((e) => !e)}>
        <View style={styles.productTop}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.productName} numberOfLines={1}>{product.productName}</Text>
            <Text style={styles.productMeta}>
              {product.previousPrice != null
                ? `was ${peso(product.previousPrice)}`
                : 'first price recorded'}
              {product.observations > 1 ? ` · ${product.observations} records` : ''}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <Text style={styles.currentPrice}>{peso(product.currentPrice)}</Text>
            {product.previousPrice != null && (
              <StatusBadge
                label={`${rising ? '+' : ''}${product.changePercent}%`}
                tone={tone}
                icon={ChangeIcon}
              />
            )}
          </View>
        </View>
      </Pressable>

      {expanded && (
        <View style={styles.history}>
          <View style={styles.sparkRow}>
            {product.trend.map((point, index) => {
              // The bars are a price *level*, which is neither good nor bad on
              // its own — only the change is. So the history is drawn neutral and
              // the last bar, the one that is "now", takes the direction: red for
              // a rise, green for a drop. It previously stayed the brand green
              // whichever way the price had gone, which put a green bar directly
              // under a red "+12%" badge.
              const isLatest = index === product.trend.length - 1;
              return (
                <View key={`${point.label}-${index}`} style={styles.sparkCol}>
                  <View style={styles.sparkTrack}>
                    <View
                      style={[
                        styles.sparkFill,
                        { height: `${Math.max((point.value / trendMax) * 100, 4)}%` },
                        isLatest && (rising ? styles.sparkFillRise
                          : falling ? styles.sparkFillDrop
                          : styles.sparkFillFlat),
                      ]}
                    />
                  </View>
                  <Text style={styles.sparkLabel} numberOfLines={1}>{point.label}</Text>
                </View>
              );
            })}
          </View>
          <Text style={styles.historyMeta}>
            Last recorded {new Date(product.lastRecordedAt).toLocaleDateString(undefined, {
              day: 'numeric', month: 'short', year: 'numeric',
            })}
            {product.change !== 0 ? ` · changed by ${peso(Math.abs(product.change))}` : ''}
          </Text>
        </View>
      )}
    </Card>
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
  container: { flex: 1, backgroundColor: COLORS.background },
  loadingBox: { paddingVertical: SPACING.xxl, alignItems: 'center' },

  spendCard: { padding: SPACING.md },
  spendRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 120 },
  spendCol: { flex: 1, alignItems: 'center', height: '100%' },
  // The amount is the number the card exists to show, so it is set at a size a
  // person can read at a glance — it was 10.5, which left the bars dominating a
  // figure that is the point of the chart.
  spendValue: { fontSize: 13.5, fontWeight: '800', color: COLORS.text, marginBottom: 4 },
  spendTrack: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  // A month's spend is a quantity, not a verdict, so the bars carry the neutral
  // chart colour rather than the brand green — which in this app means "good",
  // and was being said about a bill.
  spendFill: { width: '100%', backgroundColor: COLORS.chartBar, borderRadius: 4 },
  spendLabel: { fontSize: 10.5, color: COLORS.secondaryText, marginTop: 5 },

  productCard: { padding: SPACING.md },
  productTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  productName: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  productMeta: { fontSize: 12, color: COLORS.secondaryText, marginTop: 2 },
  currentPrice: { fontSize: 16, fontWeight: '800', color: COLORS.text },

  history: { marginTop: SPACING.md, paddingTop: SPACING.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.divider },
  sparkRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 72 },
  sparkCol: { flex: 1, alignItems: 'center', height: '100%' },
  sparkTrack: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  // Neutral, because a level on its own says nothing about whether it is good
  // news. The latest bar is re-coloured below by the direction of the change.
  // It was `neutralBg` (#E9ECEF), which is so close to the card it sits on that
  // a bar looked like an empty track waiting to be filled.
  sparkFill: { width: '100%', backgroundColor: COLORS.chartBar, borderRadius: 3 },
  sparkFillRise: { backgroundColor: COLORS.danger },
  sparkFillDrop: { backgroundColor: COLORS.success },
  sparkFillFlat: { backgroundColor: COLORS.secondaryText },
  sparkLabel: { fontSize: 9, color: COLORS.secondaryText, marginTop: 4 },
  historyMeta: { fontSize: 11.5, color: COLORS.secondaryText, marginTop: SPACING.sm },

  footnote: { fontSize: 11.5, color: COLORS.secondaryText, lineHeight: 16, marginTop: SPACING.lg },

  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center', padding: SPACING.lg,
  },
  sheet: { width: '100%', maxWidth: 420, backgroundColor: COLORS.white, borderRadius: RADII.card, padding: SPACING.lg },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: COLORS.text },
  sheetHint: { fontSize: 12.5, color: COLORS.secondaryText, marginTop: 4, marginBottom: SPACING.md, lineHeight: 17 },
  sheetError: { fontSize: 12, color: COLORS.dangerText, marginTop: SPACING.sm },
  sheetActions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.lg },
});
