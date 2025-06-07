// src/screens/LoginScreen.tsx

import React, { useState } from 'react';
import {
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  View,
  TextInput,
  TouchableOpacity,
  Text,
  Alert,
  Switch,
  StyleSheet,
} from 'react-native';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from 'firebase/auth';
import { auth } from '../firebase/firebaseconfig';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/StackNavigator';
import { useDriver } from '../drivercontext/DriverContext';

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

  const handleLogin = async () => {
    if (isDriver) {
      if (adminAccounts[email] === password) {
        setDriverId(email);
        navigation.replace('DriverHome');
      } else {
        Alert.alert('Invalid driver credentials');
      }
      return;
    }

    if (!email.endsWith('@mckendree.edu')) {
      Alert.alert('Only McKendree emails allowed');
      return;
    }

    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigation.replace('StudentHome');
    } catch (err: any) {
      if (err.code === 'auth/user-not-found') {
        try {
          await createUserWithEmailAndPassword(auth, email, password);
          navigation.replace('StudentHome');
        } catch (e: any) {
          Alert.alert('Error creating account', e.message);
        }
      } else {
        Alert.alert('Login Error', err.message);
      }
    }
  };

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
            trackColor={{ false: '#ccc', true: '#4B2E83' }}
            thumbColor="#fff"
            onValueChange={setIsDriver}
            value={isDriver}
          />
        </View>

        <TouchableOpacity style={styles.button} onPress={handleLogin}>
          <Text style={styles.buttonText}>Login / Sign Up</Text>
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
    color: '#4B2E83',
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
    backgroundColor: '#4B2E83',
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
