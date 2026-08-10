import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, View } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import {
  createCar, getCar, updateCar, uploadCarPhoto, type Transmission,
} from '@/lib/carRental';
import { AppText, Button, Card, Icon, ScreenHeader, TextField } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';

export default function AddCarScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = !!id;

  const [loading, setLoading] = useState(editing);
  const [title, setTitle] = useState('');
  const [brandModel, setBrandModel] = useState('');
  const [year, setYear] = useState('');
  const [city, setCity] = useState('');
  const [price, setPrice] = useState('');
  const [deposit, setDeposit] = useState('');
  const [transmission, setTransmission] = useState<Transmission | null>(null);
  const [seats, setSeats] = useState('');
  const [withDriver, setWithDriver] = useState(false);
  const [driverRate, setDriverRate] = useState('');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    getCar(id).then((c) => {
      setTitle(c.title); setBrandModel(c.brandModel ?? ''); setYear(c.year ? String(c.year) : '');
      setCity(c.city); setPrice(String(c.pricePerDayMru)); setDeposit(String(c.depositMru));
      setTransmission(c.transmission); setSeats(c.seats ? String(c.seats) : '');
      setWithDriver(c.withDriver); setDriverRate(c.driverDayRateMru ? String(c.driverDayRateMru) : '');
      setDescription(c.description ?? ''); setPhotos(c.photos); setPaused(c.status === 'paused');
    }).catch(() => Alert.alert(t('carRental.errTitle'), t('carRental.errCarNotFound'))).finally(() => setLoading(false));
  }, [id, t]);

  async function addPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (r.canceled || !r.assets[0]) return;
    setUploading(true);
    try {
      const url = await uploadCarPhoto(r.assets[0].uri);
      setPhotos((prev) => [...prev, url]);
    } catch {
      Alert.alert(t('carRental.errTitle'), t('carRental.add.errUploadPhoto'));
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    const priceN = parseInt(price, 10);
    if (!title.trim() || !city.trim() || !Number.isFinite(priceN) || priceN <= 0) {
      Alert.alert(t('carRental.add.incompleteTitle'), t('carRental.add.incompleteBody'));
      return;
    }
    if (withDriver && !parseInt(driverRate, 10)) {
      Alert.alert(t('carRental.add.driverIncompleteTitle'), t('carRental.add.driverIncompleteBody'));
      return;
    }
    const payload = {
      title: title.trim(),
      brand_model: brandModel.trim() || undefined,
      year: parseInt(year, 10) || undefined,
      city: city.trim(),
      price_per_day_mru: priceN,
      deposit_mru: parseInt(deposit, 10) || 0,
      with_driver: withDriver,
      driver_day_rate_mru: withDriver ? parseInt(driverRate, 10) : undefined,
      transmission: transmission ?? undefined,
      seats: parseInt(seats, 10) || undefined,
      description: description.trim() || undefined,
      photos,
    };
    setSaving(true);
    try {
      if (editing) await updateCar(id!, { ...payload, status: paused ? 'paused' : 'active' });
      else await createCar(payload);
      Alert.alert(editing ? t('carRental.add.savedEditTitle') : t('carRental.add.savedNewTitle'), t('carRental.add.savedBody'), [
        { text: t('common.ok'), onPress: () => router.back() },
      ]);
    } catch (e: any) {
      Alert.alert(t('carRental.errTitle'), e?.response?.data?.error?.message ?? t('carRental.add.errSave'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
        <ScreenHeader title={t('carRental.add.headerEdit')} onBack={() => router.back()} style={{ paddingHorizontal: spacing.lg }} />
        <ActivityIndicator style={{ marginTop: spacing.xl }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScreenHeader title={editing ? t('carRental.add.editTitle') : t('carRental.add.newTitle')} onBack={() => router.back()} style={{ paddingHorizontal: spacing.lg }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
          {photos.map((p) => (
            <View key={p}>
              <Image source={{ uri: p }} style={{ width: 110, height: 90, borderRadius: radius.md }} />
              <Pressable onPress={() => setPhotos((prev) => prev.filter((x) => x !== p))}
                style={{ position: 'absolute', top: 4, right: 4, backgroundColor: '#000a', borderRadius: radius.sm, padding: 2 }}>
                <Icon name="close" size={14} color="#fff" />
              </Pressable>
            </View>
          ))}
          <Pressable onPress={addPhoto} disabled={uploading}
            style={{ width: 110, height: 90, borderRadius: radius.md, borderWidth: 2, borderColor: colors.line, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' }}>
            {uploading ? <ActivityIndicator color={colors.ember} /> : <Icon name="sparkle" size={22} color={colors.muted} />}
            <AppText variant="caption" color={colors.muted} style={{ marginTop: 4 }}>{t('carRental.add.photoLabel')}</AppText>
          </Pressable>
        </ScrollView>

        <TextField label={t('carRental.add.titleLabel')} value={title} onChangeText={setTitle} placeholder={t('carRental.add.titlePlaceholder')} />
        <TextField label={t('carRental.add.brandModelLabel')} value={brandModel} onChangeText={setBrandModel} placeholder={t('carRental.add.brandModelPlaceholder')} />
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}><TextField label={t('carRental.add.yearLabel')} value={year} onChangeText={setYear} keyboardType="number-pad" placeholder={t('carRental.add.yearPlaceholder')} /></View>
          <View style={{ flex: 1 }}><TextField label={t('carRental.add.seatsLabel')} value={seats} onChangeText={setSeats} keyboardType="number-pad" placeholder={t('carRental.add.seatsPlaceholder')} /></View>
        </View>
        <TextField label={t('carRental.add.cityLabel')} value={city} onChangeText={setCity} placeholder={t('carRental.add.cityPlaceholder')} />
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}><TextField label={t('carRental.add.pricePerDayLabel')} value={price} onChangeText={setPrice} keyboardType="number-pad" placeholder={t('carRental.add.pricePerDayPlaceholder')} /></View>
          <View style={{ flex: 1 }}><TextField label={t('carRental.add.depositLabel')} value={deposit} onChangeText={setDeposit} keyboardType="number-pad" placeholder={t('carRental.add.depositPlaceholder')} /></View>
        </View>

        <View>
          <AppText variant="label" color={colors.ink2} style={{ marginBottom: spacing.sm }}>{t('carRental.add.transmissionLabel')}</AppText>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {(['auto', 'manual'] as Transmission[]).map((tr) => (
              <Pressable key={tr} onPress={() => setTransmission(tr)}
                style={{ flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, borderWidth: 2, alignItems: 'center',
                  borderColor: transmission === tr ? colors.ember : colors.line, backgroundColor: transmission === tr ? colors.emberSoft : '#fff' }}>
                <AppText color={transmission === tr ? colors.ember : colors.ink}>
                  {tr === 'auto' ? t('carRental.add.transmissionAutoOption') : t('carRental.add.transmissionManualOption')}
                </AppText>
              </Pressable>
            ))}
          </View>
        </View>

        <Card padding={spacing.lg} style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <AppText variant="label" color={colors.ink}>{t('carRental.add.driverAvail')}</AppText>
            <Switch value={withDriver} onValueChange={setWithDriver} />
          </View>
          {withDriver ? (
            <TextField label={t('carRental.add.driverRateLabel')} value={driverRate} onChangeText={setDriverRate} keyboardType="number-pad" placeholder={t('carRental.add.driverRatePlaceholder')} />
          ) : null}
        </Card>

        <TextField label={t('carRental.add.descriptionLabel')} value={description} onChangeText={setDescription} placeholder={t('carRental.add.descriptionPlaceholder')} multiline />

        {editing ? (
          <Card padding={spacing.lg}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <AppText variant="label" color={colors.ink}>{t('carRental.add.pauseLabel')}</AppText>
              <Switch value={paused} onValueChange={setPaused} />
            </View>
          </Card>
        ) : null}

        <Button title={editing ? t('carRental.add.saveEdit') : t('carRental.add.saveNew')} icon="check" busy={saving} onPress={save} />
      </ScrollView>
    </SafeAreaView>
  );
}
