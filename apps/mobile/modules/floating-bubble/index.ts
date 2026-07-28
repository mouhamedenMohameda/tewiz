/**
 * Local Expo module: Android-only floating-bubble ("system overlay") bridge
 * (see android/.../FloatingBubbleModule.kt).
 *
 * Consumers should NOT import this file directly — use lib/floatingBubble.ts,
 * which resolves the native module by name (`requireOptionalNativeModule
 * ('FloatingBubble')`) and no-ops gracefully when it isn't linked (iOS, web,
 * old builds). This index just re-exports the same optional handle for anyone
 * who wants the raw native surface.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

export default requireOptionalNativeModule('FloatingBubble');
