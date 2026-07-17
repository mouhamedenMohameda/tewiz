/**
 * SplashGate — Shows splash screen on app cold start, then fades away
 */

import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import SplashScreen from './SplashScreen';

interface SplashGateProps {
  children: React.ReactNode;
  showDuration?: number;
}

export const SplashGate: React.FC<SplashGateProps> = ({
  children,
  showDuration = 30000,
}) => {
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    // Splash stays visible for its animation duration, then fades
    const timer = setTimeout(() => {
      setShowSplash(false);
    }, showDuration);

    return () => clearTimeout(timer);
  }, [showDuration]);

  return (
    <View style={styles.container}>
      {children}
      {showSplash && <SplashScreen />}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

export default SplashGate;
