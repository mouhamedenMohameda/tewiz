import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

// Shared form primitives so the KYC screens stay tidy.

export function Field({
  label, value, onChangeText, placeholder, keyboardType, autoCapitalize, helper, maxLength,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'number-pad' | 'phone-pad' | 'email-address';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  helper?: string;
  maxLength?: number;
}) {
  return (
    <View style={{ marginTop: 16 }}>
      <Text style={{ fontSize: 13, color: '#475569', marginBottom: 6 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType={keyboardType ?? 'default'}
        autoCapitalize={autoCapitalize ?? 'sentences'}
        maxLength={maxLength}
        placeholderTextColor="#94a3b8"
        style={{
          borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12,
          paddingHorizontal: 14, paddingVertical: 12, fontSize: 16,
          color: '#0f172a', backgroundColor: '#fff',
        }}
      />
      {helper ? (
        <Text style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{helper}</Text>
      ) : null}
    </View>
  );
}

export function PrimaryButton({
  title, onPress, busy, disabled,
}: {
  title: string; onPress: () => void; busy?: boolean; disabled?: boolean;
}) {
  return (
    <Pressable
      disabled={busy || disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        marginTop: 24,
        backgroundColor: pressed ? '#0f7c4a' : '#10a35e',
        opacity: busy || disabled ? 0.5 : 1,
        paddingVertical: 16, borderRadius: 12,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      })}
    >
      {busy && <ActivityIndicator color="#fff" />}
      <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>{title}</Text>
    </Pressable>
  );
}
