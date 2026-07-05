import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  CATEGORY_META,
  WINDOW_OPTIONS,
  listCategories,
  publishListing,
  type ListingCategory,
} from '@/lib/listings';
import { formatMru } from '@/lib/format';
import { AppText, Button, Card, ScreenHeader, TextField } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';

export default function PublishListingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ category?: string }>();
  const category = params.category ?? 'car_rental';
  const meta = CATEGORY_META[category];

  const [config, setConfig] = useState<ListingCategory | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [phone, setPhone] = useState('');
  const [windowDays, setWindowDays] = useState<number>(WINDOW_OPTIONS[1]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listCategories()
      .then((cats) => setConfig(cats.find((c) => c.category === category) ?? null))
      .catch(() => setConfig(null));
  }, [category]);

  async function submit() {
    const priceMru = parseInt(price, 10);
    if (!title.trim() || !Number.isFinite(priceMru) || priceMru <= 0) {
      Alert.alert('Incomplet', 'Renseignez un titre et un prix valide.');
      return;
    }
    setSaving(true);
    try {
      await publishListing({
        category,
        title: title.trim(),
        description: description.trim() || undefined,
        price_mru: priceMru,
        price_unit: meta?.priceUnit ?? 'fixed',
        provider_phone: phone.trim() || undefined,
        window_days: windowDays,
      });
      Alert.alert('Publiée', 'Votre annonce est maintenant visible.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e: any) {
      const code = e?.response?.data?.error?.code;
      const msg = code === 'insufficient_wallet'
        ? 'Solde insuffisant pour payer la publication.'
        : e?.response?.data?.error?.message ?? 'Échec de la publication.';
      Alert.alert('Erreur', msg);
    } finally {
      setSaving(false);
    }
  }

  const fee = config?.publicationFeeMru ?? 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      <ScreenHeader title={`Publier · ${meta?.label ?? 'Annonce'}`} onBack={() => router.back()} />

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
        <Card padding={spacing.lg} style={{ gap: spacing.md }}>
          <View>
            <AppText variant="caption" color={colors.ink2}>TITRE</AppText>
            <TextField
              value={title}
              onChangeText={setTitle}
              placeholder="Ex: Toyota Hilux disponible"
              containerStyle={{ marginTop: spacing.xs }}
            />
          </View>

          <View>
            <AppText variant="caption" color={colors.ink2}>DESCRIPTION</AppText>
            <TextField
              value={description}
              onChangeText={setDescription}
              placeholder="Détails, conditions, zone… (optionnel)"
              multiline
              containerStyle={{ marginTop: spacing.xs }}
            />
          </View>

          <View>
            <AppText variant="caption" color={colors.ink2}>
              {(meta?.pricePrompt ?? 'Prix').toUpperCase()} (MRU{meta?.unitSuffix ?? ''})
            </AppText>
            <TextField
              value={price}
              onChangeText={setPrice}
              placeholder="0"
              keyboardType="number-pad"
              containerStyle={{ marginTop: spacing.xs }}
            />
          </View>

          <View>
            <AppText variant="caption" color={colors.ink2}>TÉLÉPHONE (optionnel)</AppText>
            <TextField
              value={phone}
              onChangeText={setPhone}
              placeholder="Laisser vide = votre numéro de compte"
              keyboardType="phone-pad"
              containerStyle={{ marginTop: spacing.xs }}
            />
          </View>
        </Card>

        <View>
          <AppText variant="caption" color={colors.ink2} style={{ marginBottom: spacing.sm }}>
            DURÉE DE VISIBILITÉ
          </AppText>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {WINDOW_OPTIONS.map((d) => (
              <Pressable
                key={d}
                onPress={() => setWindowDays(d)}
                style={{
                  flex: 1,
                  paddingVertical: spacing.md,
                  borderRadius: radius.lg,
                  borderWidth: 2,
                  borderColor: windowDays === d ? colors.ember : colors.line,
                  backgroundColor: windowDays === d ? colors.emberSoft : '#fff',
                  alignItems: 'center',
                }}
              >
                <AppText variant="label" color={windowDays === d ? colors.ember : colors.ink}>
                  {d} jours
                </AppText>
              </Pressable>
            ))}
          </View>
        </View>

        <Card padding={spacing.lg} style={{ backgroundColor: colors.emberSoft }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <AppText variant="body" color={colors.ink2}>Frais de publication</AppText>
            <AppText variant="h2" color={colors.ember}>{formatMru(fee)}</AppText>
          </View>
          <AppText variant="caption" color={colors.muted} style={{ marginTop: spacing.xs }}>
            Débité de votre wallet. L'annonce reste visible {windowDays} jours.
          </AppText>
        </Card>

        <Button
          title={`Payer ${formatMru(fee)} et publier`}
          icon="check"
          onPress={submit}
          busy={saving}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
