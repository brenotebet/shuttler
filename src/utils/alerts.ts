import { Alert } from 'react-native';

export function showAlert(message: string, title = 'BogeyBus') {
  Alert.alert(title, message);
}
