import React from 'react';
import { SafeAreaView, TouchableOpacity, Text, StyleSheet } from 'react-native';
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
import { PRIMARY_COLOR } from '../src/constants/theme';

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
    <SafeAreaView style={styles.container}>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    paddingTop: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  button: {
    backgroundColor: PRIMARY_COLOR,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    marginVertical: 8,
    minWidth: 200,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
});
