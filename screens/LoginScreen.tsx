import React, { useState } from 'react';
import { View, TextInput, Button, Text, Alert, Switch } from 'react-native';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase/firebaseconfig';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/StackNavigator';

const adminAccounts: { [key: string]: string } = {
  driver1: 'bus123',
  driver2: 'bus456',
};

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Login'>;
};

export default function LoginScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isDriver, setIsDriver] = useState(false);

  const handleLogin = async () => {
    if (isDriver) {
      if (adminAccounts[email] === password) {
        navigation.replace('AdminDriver');
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
      navigation.replace('Map');
    } catch (err: any) {
      if (err.code === 'auth/user-not-found') {
        try {
          await createUserWithEmailAndPassword(auth, email, password);
          navigation.replace('Map');
        } catch (e: any) {
          Alert.alert('Error creating account', e.message);
        }
      } else {
        Alert.alert('Login Error', err.message);
      }
    }
  };

  return (
    <View style={{ padding: 20 }}>
      <Text>{isDriver ? 'Driver ID' : 'Student Email'}</Text>
      <TextInput
        placeholder={isDriver ? 'driver1' : 'you@mckendree.edu'}
        autoCapitalize="none"
        value={email}
        onChangeText={setEmail}
        style={{ borderBottomWidth: 1, marginBottom: 12 }}
      />

      <Text>Password</Text>
      <TextInput
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        style={{ borderBottomWidth: 1, marginBottom: 20 }}
      />

      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
        <Text style={{ marginRight: 10 }}>Login as Driver</Text>
        <Switch value={isDriver} onValueChange={setIsDriver} />
      </View>

      <Button title="Login / Sign Up" onPress={handleLogin} />
    </View>
  );
}
