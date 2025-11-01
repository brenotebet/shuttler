import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import {
  BottomTabNavigationProp,
} from '@react-navigation/bottom-tabs';
import {
  CompositeNavigationProp,
  useNavigation,
} from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/StackNavigator';
import { StudentTabParamList } from '../tabs/StudentTabs';
import { auth } from '../firebase/firebaseconfig';
import MenuItem from '../components/MenuItem';
import ScreenContainer from '../components/ScreenContainer';
import { PRIMARY_COLOR } from '../src/constants/theme';
import { spacing } from '../src/styles/common';

export default function StudentMenuScreen() {
  const navigation = useNavigation<
    CompositeNavigationProp<
      BottomTabNavigationProp<StudentTabParamList, 'Menu'>,
      NativeStackNavigationProp<RootStackParamList>
    >
  >();

  const handleLogout = async () => {
    try {
      await auth.signOut();
    } catch (err) {
      console.error('Error signing out', err);
    }
    navigation.replace('Login');
  };

  return (
    <ScreenContainer>
      <View style={styles.hero}>
        <Text style={styles.title}>Student Center</Text>
        <Text style={styles.subtitle}>Manage your rides and profile</Text>
      </View>

      <View>
        <MenuItem
          icon="history"
          title="History"
          description="Take a look at your past completed rides"
          onPress={() => navigation.navigate('StudentHistory')}
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
