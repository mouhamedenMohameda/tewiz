/**
 * Captain → Autorisations. The recovery view for the permissions panel, reached
 * from Settings. Same component as the first-run onboarding, minus the skip:
 * a captain who came here on purpose wants to fix something.
 */

import { useRouter } from 'expo-router';
import { CaptainPermissions } from '@/components/CaptainPermissions';

export default function CaptainPermissionsScreen() {
  const router = useRouter();
  return <CaptainPermissions mode="settings" onDone={() => router.back()} />;
}
