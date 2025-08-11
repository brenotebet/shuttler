// src/screens/LoginScreen.tsx

import React, { useState, useCallback } from 'react';
import {
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  View,
  TextInput,
  TouchableOpacity,
  Text,
  Switch,
  StyleSheet,
} from 'react-native';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from 'firebase/auth';
import { auth } from '../firebase/firebaseconfig';
import { signInWithQuickLaunch } from '../quicklaunch/quicklaunchAuth';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/StackNavigator';
import { useDriver } from '../drivercontext/DriverContext';
import { showAlert } from '../src/utils/alerts';
import { PRIMARY_COLOR } from '../src/constants/theme';

const adminAccounts: { [key: string]: string } = {
  driver1: 'bus123',
  driver2: 'bus456',
  driver3: 'bus789',
};

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Login'>;
};

export default function LoginScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isDriver, setIsDriver] = useState(false);
  const { setDriverId } = useDriver();

  const handleLogin = useCallback(async () => {
    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();

    if (isDriver) {
      if (adminAccounts[trimmedEmail] === trimmedPassword) {
        setDriverId(trimmedEmail);
        navigation.replace('DriverHome');
      } else {
        showAlert('Invalid driver credentials');
      }
      return;
    }

    if (!trimmedEmail.endsWith('@mckendree.edu')) {
      showAlert('Only McKendree emails are allowed.');
      return;
    }

    try {
      await signInWithEmailAndPassword(auth, trimmedEmail, trimmedPassword);
      navigation.replace('StudentHome');
    } catch (err: any) {
      if (err.code === 'auth/user-not-found') {
        try {
          await createUserWithEmailAndPassword(auth, trimmedEmail, trimmedPassword);
          navigation.replace('StudentHome');
        } catch (e: any) {
          showAlert(e.message, 'Error creating account');
        }
      } else {
        showAlert(err.message, 'Login Error');
      }
    }
  }, [email, password, isDriver, navigation, setDriverId]);

  const handleQuickLaunch = useCallback(async () => {
    try {
      await signInWithQuickLaunch();
      navigation.replace('StudentHome');
    } catch (e: any) {
      showAlert(e.message, 'SSO Error');
    }
  }, [navigation]);

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Text style={styles.header}>Welcome to BogeyBus</Text>

        <View style={styles.field}>
          <Text style={styles.label}>
            {isDriver ? 'Driver ID' : 'Student Email'}
          </Text>
          <TextInput
            style={styles.input}
            placeholder={isDriver ? 'driver1' : 'you@mckendree.edu'}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            placeholder="••••••••"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
        </View>

        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Login as Driver</Text>
          <Switch
            trackColor={{ false: '#ccc', true: PRIMARY_COLOR }}
            thumbColor="#fff"
            onValueChange={setIsDriver}
            value={isDriver}
          />
        </View>

        <TouchableOpacity style={styles.button} onPress={handleLogin}>
          <Text style={styles.buttonText}>Login / Sign Up</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, { marginTop: 12 }]}
          onPress={handleQuickLaunch}
        >
          <Text style={styles.buttonText}>Login with QuickLaunch</Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  header: {
    fontSize: 28,
    fontWeight: '600',
    color: PRIMARY_COLOR,
    textAlign: 'center',
    marginBottom: 32,
  },
  field: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    color: '#444',
    marginBottom: 6,
    fontWeight: '500',
  },
  input: {
    height: 48,
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
    fontSize: 16,
    paddingHorizontal: 4,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 32,
  },
  switchLabel: {
    fontSize: 16,
    color: '#333',
  },
  button: {
    backgroundColor: PRIMARY_COLOR,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    elevation: 2,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
});
