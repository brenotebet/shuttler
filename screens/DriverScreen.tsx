import { Button, View } from 'react-native';
import { useLocationSharing } from '../location/LocationContext';

export default function DriverScreen() {
  const { isSharing, startSharing, stopSharing } = useLocationSharing();

  return (
    <View style={{ padding: 20 }}>
      <Button
        title={isSharing ? 'Stop Sharing Location' : 'Start Sharing Location'}
        onPress={isSharing ? stopSharing : startSharing}
      />
    </View>
  );
}