import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

export interface RideCancelReasonOption {
  key: string;
  label: string;
}

interface RideCancelReasonSheetProps {
  visible: boolean;
  title: string;
  body: string;
  options: RideCancelReasonOption[];
  busy?: boolean;
  onClose: () => void;
  onSelect: (key: string) => void;
}

export function RideCancelReasonSheet({
  visible,
  title,
  body,
  options,
  busy = false,
  onClose,
  onSelect,
}: RideCancelReasonSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{
        flex: 1,
        backgroundColor: 'rgba(15,23,42,0.55)',
        justifyContent: 'flex-end',
      }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={{
          backgroundColor: '#fff',
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          paddingHorizontal: 20,
          paddingTop: 18,
          paddingBottom: 28,
          maxHeight: '72%',
        }}>
          <Text style={{ fontSize: 18, fontWeight: '800', color: '#0f172a' }}>{title}</Text>
          <Text style={{ fontSize: 13, color: '#64748b', marginTop: 6 }}>{body}</Text>

          <ScrollView style={{ marginTop: 16 }} contentContainerStyle={{ gap: 10 }}>
            {options.map((option) => (
              <Pressable
                key={option.key}
                disabled={busy}
                onPress={() => onSelect(option.key)}
                style={({ pressed }) => ({
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: '#e2e8f0',
                  backgroundColor: pressed ? '#f8fafc' : '#fff',
                  paddingHorizontal: 14,
                  paddingVertical: 14,
                  opacity: busy ? 0.5 : 1,
                })}
              >
                <Text style={{ fontSize: 15, fontWeight: '600', color: '#0f172a' }}>{option.label}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <Pressable
            disabled={busy}
            onPress={onClose}
            style={({ pressed }) => ({
              marginTop: 16,
              alignItems: 'center',
              paddingVertical: 12,
              borderRadius: 12,
              backgroundColor: pressed ? '#e2e8f0' : '#f1f5f9',
              opacity: busy ? 0.5 : 1,
            })}
          >
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#334155' }}>Fermer</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}