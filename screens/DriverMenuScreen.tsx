import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/StackNavigator';
import { useDriver } from '../drivercontext/DriverContext';
import { useLocationSharing } from '../location/LocationContext';
import MenuItem from '../components/MenuItem';
import ScreenContainer from '../components/ScreenContainer';
import { PRIMARY_COLOR } from '../src/constants/theme';
import { spacing } from '../src/styles/common';

export default function DriverMenuScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { logout } = useDriver();
  const { stopSharing, isSharing } = useLocationSharing();

  const handleLogout = async () => {
    try {
      if (isSharing) {
        await stopSharing();
      }
    } catch (err) {
      console.error('Error stopping sharing on logout', err);
    }
    logout();
    navigation.replace('Login');
  };

  return (
    <ScreenContainer>
      <View style={styles.hero}>
        <Text style={styles.title}>Driver Hub</Text>
        <Text style={styles.subtitle}>Stay on top of requests and routes</Text>
      </View>

      <View>
        <MenuItem
          icon="history"
          title="History"
          description="Take a look at your past completed rides"
          onPress={() => navigation.navigate('DriverHistory')}
        />
        <MenuItem
          icon="list"
          title="Requested Rides"
          description="View and manage current ride requests"
          onPress={() => navigation.navigate('AdminDriver')}
        />
        <MenuItem
          icon="logout"
          title="Logout"
          description="Sign out of your account"
          onPress={handleLogout}
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  hero: {
    marginBottom: spacing.section * 1.5,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: PRIMARY_COLOR,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: '#4b5563',
  },
});
