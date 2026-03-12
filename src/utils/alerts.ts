import { Alert } from 'react-native';

export function showAlert(message: string, title = 'Shuttler') {
  Alert.alert(title, message);
}
