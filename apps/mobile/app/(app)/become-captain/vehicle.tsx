import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  Pressable, ScrollView, Switch, Text, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/lib/api';
import { type ApplicationDto } from '@/lib/kyc';
import { Field, PrimaryButton } from '@/lib/form';

export default function VehicleScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [plate, setPlate] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [color, setColor] = useState('');
  const [seats, setSeats] = useState('4');
  const [acceptsColis, setAcceptsColis] = useState(false);
  const [acceptsLongDistance, setAcceptsLongDistance] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get<ApplicationDto>('/captain/applications/me');
        if (r.data) {
          setPlate(r.data.vehiclePlate ?? '');
          setBrand(r.data.vehicleBrand ?? '');
          setModel(r.data.vehicleModel ?? '');
          setYear(r.data.vehicleYear?.toString() ?? '');
          setColor(r.data.vehicleColor ?? '');
          setSeats(r.data.vehicleSeats?.toString() ?? '4');
          setAcceptsColis(r.data.acceptsColis);
          setAcceptsLongDistance(r.data.acceptsLongDistance);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save() {
    const yearNum = Number(year);
    const seatsNum = Number(seats);
    const currentYear = new Date().getFullYear();
    if (!yearNum || yearNum < 1980 || yearNum > currentYear + 1) {
      Alert.alert(t('becomeCaptain.vehicle.yearInvalidTitle'), t('becomeCaptain.vehicle.yearInvalidBody', { max: currentYear + 1 }));
      return;
    }
    if (!seatsNum || seatsNum < 1 || seatsNum > 8) {
      Alert.alert(t('becomeCaptain.vehicle.seatsInvalidTitle'), t('becomeCaptain.vehicle.seatsInvalidBody'));
      return;
    }
    setSaving(true);
    try {
      await api.patch('/captain/applications/me', {
        vehiclePlate: plate.trim().toUpperCase(),
        vehicleBrand: brand.trim(),
        vehicleModel: model.trim(),
        vehicleYear: yearNum,
        vehicleColor: color.trim(),
        vehicleSeats: seatsNum,
        acceptsColis,
        acceptsLongDistance,
      });
      router.back();
    } catch (e: any) {
      Alert.alert(t('common.error'), e.response?.data?.error?.message ?? t('becomeCaptain.vehicle.saveError'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          <Pressable onPress={() => router.back()}>
            <Text style={{ color: '#64748b', fontSize: 14 }}>‹ {t('common.back')}</Text>
          </Pressable>
          <Text style={{ fontSize: 24, fontWeight: '700', color: '#0f172a', marginTop: 12 }}>
            {t('becomeCaptain.vehicle.title')}
          </Text>

          <Field label={t('becomeCaptain.vehicle.plate')} value={plate}
            onChangeText={setPlate} placeholder={t('becomeCaptain.vehicle.platePlaceholder')} autoCapitalize="characters" />
          <Field label={t('becomeCaptain.vehicle.brand')} value={brand} onChangeText={setBrand}
            placeholder={t('becomeCaptain.vehicle.brandPlaceholder')} autoCapitalize="words" />
          <Field label={t('becomeCaptain.vehicle.model')} value={model} onChangeText={setModel}
            placeholder={t('becomeCaptain.vehicle.modelPlaceholder')} autoCapitalize="words" />
          <Field label={t('becomeCaptain.vehicle.year')} value={year}
            onChangeText={(v) => setYear(v.replace(/\D/g, '').slice(0, 4))}
            placeholder={t('becomeCaptain.vehicle.yearPlaceholder')} keyboardType="number-pad" maxLength={4} />
          <Field label={t('becomeCaptain.vehicle.color')} value={color} onChangeText={setColor}
            placeholder={t('becomeCaptain.vehicle.colorPlaceholder')} autoCapitalize="words" />
          <Field label={t('becomeCaptain.vehicle.seats')} value={seats}
            onChangeText={(v) => setSeats(v.replace(/\D/g, '').slice(0, 1))}
            placeholder="4" keyboardType="number-pad" maxLength={1} />

          <View style={{
            marginTop: 24, backgroundColor: '#fff', borderRadius: 14, padding: 16,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: '#0f172a' }}>{t('becomeCaptain.vehicle.colisTitle')}</Text>
              <Text style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                {t('becomeCaptain.vehicle.colisHint')}
              </Text>
            </View>
            <Switch value={acceptsColis} onValueChange={setAcceptsColis} />
          </View>

          <View style={{
            marginTop: 12, backgroundColor: '#fff', borderRadius: 14, padding: 16,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: '#0f172a' }}>{t('becomeCaptain.vehicle.longDistanceTitle')}</Text>
              <Text style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                {t('becomeCaptain.vehicle.longDistanceHint')}
              </Text>
            </View>
            <Switch value={acceptsLongDistance} onValueChange={setAcceptsLongDistance} />
          </View>

          <PrimaryButton title={t('becomeCaptain.vehicle.save')} onPress={save} busy={saving} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
