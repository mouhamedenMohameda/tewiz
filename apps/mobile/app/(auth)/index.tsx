/**
 * Welcome / entry screen.
 *
 * Self-signup has been disabled — accounts are created by an
 * administrator who sends the initial password via WhatsApp. So this
 * screen now offers a single CTA (Se connecter) plus a short note
 * about how to get an account.
 */

import { Linking, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

const ADMIN_WHATSAPP = '+22245000000';

export default function AuthWelcome() {
  const router = useRouter();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      <View style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
        <Text style={{ fontSize: 32, fontWeight: '700', color: '#0f172a' }}>
          Tewiz
        </Text>
        <Text style={{ fontSize: 16, color: '#64748b', marginTop: 8, lineHeight: 22 }}>
          Commandez une course. Devenez chauffeur quand vous voulez.
        </Text>

        <Pressable
          onPress={() => router.push('/(auth)/phone')}
          style={({ pressed }) => ({
            marginTop: 48,
            backgroundColor: pressed ? '#0f7c4a' : '#10a35e',
            paddingVertical: 16, borderRadius: 12,
            alignItems: 'center', justifyContent: 'center',
          })}
        >
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>
            Se connecter
          </Text>
        </Pressable>

        <Pressable
          onPress={() => {
            const url = `https://wa.me/${ADMIN_WHATSAPP.replace(/[^\d]/g, '')}?text=` +
              encodeURIComponent('Bonjour, je voudrais créer un compte Tewiz.');
            Linking.openURL(url).catch(() => undefined);
          }}
          style={({ pressed }) => ({
            marginTop: 12,
            backgroundColor: pressed ? '#f1f5f9' : '#fff',
            paddingVertical: 16, borderRadius: 12,
            borderWidth: 1, borderColor: '#cbd5e1',
            alignItems: 'center', justifyContent: 'center',
          })}
        >
          <Text style={{ color: '#0f172a', fontSize: 14, fontWeight: '600' }}>
            Demander un compte (WhatsApp)
          </Text>
        </Pressable>

        <Text style={{ marginTop: 24, fontSize: 12, color: '#94a3b8', lineHeight: 18, textAlign: 'center' }}>
          Pas de SMS : votre mot de passe vous sera transmis par l'administrateur.
        </Text>
      </View>
    </SafeAreaView>
  );
}
