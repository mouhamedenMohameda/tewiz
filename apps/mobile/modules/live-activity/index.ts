/**
 * Local Expo module: iOS-only ActivityKit bridge (see ios/LiveActivityModule.swift).
 *
 * Consumers should NOT import this file directly — use lib/liveActivity.ts,
 * which resolves the native module by name (`requireOptionalNativeModule
 * ('LiveActivity')`) and no-ops gracefully when it isn't linked (Android, web,
 * old builds). This index just re-exports the same optional handle for anyone
 * who wants the raw native surface.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

export default requireOptionalNativeModule('LiveActivity');
