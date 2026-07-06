import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, Switch, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import {
  createCar, getCar, updateCar, uploadCarPhoto, type Transmission,
} from '@/lib/carRental';
import { AppText, Button, Card, Icon, ScreenHeader, TextField } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';

export default function AddCarScreen() {
  const router = useRouter();
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
    }).catch(() => Alert.alert('Erreur', 'Voiture introuvable')).finally(() => setLoading(false));
  }, [id]);

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
      Alert.alert('Erreur', 'Upload de la photo impossible.');
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    const priceN = parseInt(price, 10);
    if (!title.trim() || !city.trim() || !Number.isFinite(priceN) || priceN <= 0) {
      Alert.alert('Incomplet', 'Titre, ville et prix/jour sont requis.');
      return;
    }
    if (withDriver && !parseInt(driverRate, 10)) {
      Alert.alert('Chauffeur', 'Indiquez le tarif chauffeur/jour.');
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
      Alert.alert(editing ? 'Enregistré' : 'Publiée', 'Votre voiture est à jour.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e: any) {
      Alert.alert('Erreur', e?.response?.data?.error?.message ?? 'Enregistrement impossible.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
        <ScreenHeader title="Modifier" onBack={() => router.back()} />
        <ActivityIndicator style={{ marginTop: spacing.xl }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScreenHeader title={editing ? 'Modifier la voiture' : 'Ajouter une voiture'} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        {/* Photos */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
          {photos.map((p) => (
            <View key={p}>
              <Image source={{ uri: p }} style={{ width: 110, height: 90, borderRadius: radius.md }} />
              <Pressable onPress={() => setPhotos((prev) => prev.filter((x) => x !== p))}
                style={{ position: 'absolute', top: 4, right: 4, backgroundColor: '#000a', borderRadius: 10, padding: 2 }}>
                <Icon name="close" size={14} color="#fff" />
              </Pressable>
            </View>
          ))}
          <Pressable onPress={addPhoto} disabled={uploading}
            style={{ width: 110, height: 90, borderRadius: radius.md, borderWidth: 2, borderColor: colors.line, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' }}>
            {uploading ? <ActivityIndicator color={colors.ember} /> : <Icon name="sparkle" size={22} color={colors.muted} />}
            <AppText variant="caption" color={colors.muted} style={{ marginTop: 4 }}>Photo</AppText>
          </Pressable>
        </ScrollView>

        <TextField label="Titre" value={title} onChangeText={setTitle} placeholder="Ex: Toyota Corolla 2020" />
        <TextField label="Marque / modèle" value={brandModel} onChangeText={setBrandModel} placeholder="Toyota Corolla" />
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}><TextField label="Année" value={year} onChangeText={setYear} keyboardType="number-pad" placeholder="2020" /></View>
          <View style={{ flex: 1 }}><TextField label="Places" value={seats} onChangeText={setSeats} keyboardType="number-pad" placeholder="5" /></View>
        </View>
        <TextField label="Ville" value={city} onChangeText={setCity} placeholder="Nouakchott" />
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}><TextField label="Prix / jour (MRU)" value={price} onChangeText={setPrice} keyboardType="number-pad" placeholder="5000" /></View>
          <View style={{ flex: 1 }}><TextField label="Caution (MRU)" value={deposit} onChangeText={setDeposit} keyboardType="number-pad" placeholder="20000" /></View>
        </View>

        <View>
          <AppText variant="label" color={colors.ink2} style={{ marginBottom: spacing.sm }}>Boîte</AppText>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {(['auto', 'manual'] as Transmission[]).map((tr) => (
              <Pressable key={tr} onPress={() => setTransmission(tr)}
                style={{ flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, borderWidth: 2, alignItems: 'center',
                  borderColor: transmission === tr ? colors.ember : colors.line, backgroundColor: transmission === tr ? colors.emberSoft : '#fff' }}>
                <AppText color={transmission === tr ? colors.ember : colors.ink}>{tr === 'auto' ? 'Automatique' : 'Manuelle'}</AppText>
              </Pressable>
            ))}
          </View>
        </View>

        <Card padding={spacing.lg} style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <AppText variant="label" color={colors.ink}>Chauffeur disponible</AppText>
            <Switch value={withDriver} onValueChange={setWithDriver} />
          </View>
          {withDriver ? (
            <TextField label="Tarif chauffeur / jour (MRU)" value={driverRate} onChangeText={setDriverRate} keyboardType="number-pad" placeholder="3000" />
          ) : null}
        </Card>

        <TextField label="Description" value={description} onChangeText={setDescription} placeholder="État, conditions, options…" multiline />

        {editing ? (
          <Card padding={spacing.lg}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <AppText variant="label" color={colors.ink}>Mettre en pause</AppText>
              <Switch value={paused} onValueChange={setPaused} />
            </View>
          </Card>
        ) : null}

        <Button title={editing ? 'Enregistrer' : 'Publier ma voiture'} icon="check" busy={saving} onPress={save} />
      </ScrollView>
    </SafeAreaView>
  );
}
