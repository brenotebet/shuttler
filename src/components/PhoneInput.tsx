import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  FlatList,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';

export type Country = {
  flag: string;
  name: string;
  code: string;
  dialCode: string;
};

export const COUNTRIES: Country[] = [
  // North America first — most likely defaults
  { flag: '🇺🇸', name: 'United States',    code: 'US', dialCode: '+1'   },
  { flag: '🇨🇦', name: 'Canada',            code: 'CA', dialCode: '+1'   },
  { flag: '🇲🇽', name: 'Mexico',            code: 'MX', dialCode: '+52'  },
  // English-speaking
  { flag: '🇬🇧', name: 'United Kingdom',    code: 'GB', dialCode: '+44'  },
  { flag: '🇦🇺', name: 'Australia',         code: 'AU', dialCode: '+61'  },
  { flag: '🇳🇿', name: 'New Zealand',       code: 'NZ', dialCode: '+64'  },
  { flag: '🇮🇪', name: 'Ireland',           code: 'IE', dialCode: '+353' },
  // Europe
  { flag: '🇩🇪', name: 'Germany',           code: 'DE', dialCode: '+49'  },
  { flag: '🇫🇷', name: 'France',            code: 'FR', dialCode: '+33'  },
  { flag: '🇪🇸', name: 'Spain',             code: 'ES', dialCode: '+34'  },
  { flag: '🇮🇹', name: 'Italy',             code: 'IT', dialCode: '+39'  },
  { flag: '🇵🇹', name: 'Portugal',          code: 'PT', dialCode: '+351' },
  { flag: '🇳🇱', name: 'Netherlands',       code: 'NL', dialCode: '+31'  },
  { flag: '🇧🇪', name: 'Belgium',           code: 'BE', dialCode: '+32'  },
  { flag: '🇨🇭', name: 'Switzerland',       code: 'CH', dialCode: '+41'  },
  { flag: '🇦🇹', name: 'Austria',           code: 'AT', dialCode: '+43'  },
  { flag: '🇸🇪', name: 'Sweden',            code: 'SE', dialCode: '+46'  },
  { flag: '🇳🇴', name: 'Norway',            code: 'NO', dialCode: '+47'  },
  { flag: '🇩🇰', name: 'Denmark',           code: 'DK', dialCode: '+45'  },
  { flag: '🇫🇮', name: 'Finland',           code: 'FI', dialCode: '+358' },
  { flag: '🇵🇱', name: 'Poland',            code: 'PL', dialCode: '+48'  },
  { flag: '🇷🇺', name: 'Russia',            code: 'RU', dialCode: '+7'   },
  { flag: '🇺🇦', name: 'Ukraine',           code: 'UA', dialCode: '+380' },
  { flag: '🇬🇷', name: 'Greece',            code: 'GR', dialCode: '+30'  },
  // Latin America
  { flag: '🇧🇷', name: 'Brazil',            code: 'BR', dialCode: '+55'  },
  { flag: '🇦🇷', name: 'Argentina',         code: 'AR', dialCode: '+54'  },
  { flag: '🇨🇴', name: 'Colombia',          code: 'CO', dialCode: '+57'  },
  { flag: '🇨🇱', name: 'Chile',             code: 'CL', dialCode: '+56'  },
  { flag: '🇵🇪', name: 'Peru',              code: 'PE', dialCode: '+51'  },
  // Asia
  { flag: '🇯🇵', name: 'Japan',             code: 'JP', dialCode: '+81'  },
  { flag: '🇰🇷', name: 'South Korea',       code: 'KR', dialCode: '+82'  },
  { flag: '🇨🇳', name: 'China',             code: 'CN', dialCode: '+86'  },
  { flag: '🇮🇳', name: 'India',             code: 'IN', dialCode: '+91'  },
  { flag: '🇵🇭', name: 'Philippines',       code: 'PH', dialCode: '+63'  },
  { flag: '🇸🇬', name: 'Singapore',         code: 'SG', dialCode: '+65'  },
  { flag: '🇭🇰', name: 'Hong Kong',         code: 'HK', dialCode: '+852' },
  { flag: '🇹🇼', name: 'Taiwan',            code: 'TW', dialCode: '+886' },
  { flag: '🇮🇩', name: 'Indonesia',         code: 'ID', dialCode: '+62'  },
  { flag: '🇲🇾', name: 'Malaysia',          code: 'MY', dialCode: '+60'  },
  { flag: '🇹🇭', name: 'Thailand',          code: 'TH', dialCode: '+66'  },
  { flag: '🇻🇳', name: 'Vietnam',           code: 'VN', dialCode: '+84'  },
  { flag: '🇵🇰', name: 'Pakistan',          code: 'PK', dialCode: '+92'  },
  { flag: '🇧🇩', name: 'Bangladesh',        code: 'BD', dialCode: '+880' },
  // Middle East
  { flag: '🇦🇪', name: 'UAE',               code: 'AE', dialCode: '+971' },
  { flag: '🇸🇦', name: 'Saudi Arabia',      code: 'SA', dialCode: '+966' },
  { flag: '🇮🇱', name: 'Israel',            code: 'IL', dialCode: '+972' },
  { flag: '🇹🇷', name: 'Turkey',            code: 'TR', dialCode: '+90'  },
  { flag: '🇮🇶', name: 'Iraq',              code: 'IQ', dialCode: '+964' },
  { flag: '🇮🇷', name: 'Iran',              code: 'IR', dialCode: '+98'  },
  { flag: '🇯🇴', name: 'Jordan',            code: 'JO', dialCode: '+962' },
  // Africa
  { flag: '🇿🇦', name: 'South Africa',      code: 'ZA', dialCode: '+27'  },
  { flag: '🇳🇬', name: 'Nigeria',           code: 'NG', dialCode: '+234' },
  { flag: '🇰🇪', name: 'Kenya',             code: 'KE', dialCode: '+254' },
  { flag: '🇬🇭', name: 'Ghana',             code: 'GH', dialCode: '+233' },
  { flag: '🇪🇹', name: 'Ethiopia',          code: 'ET', dialCode: '+251' },
  { flag: '🇪🇬', name: 'Egypt',             code: 'EG', dialCode: '+20'  },
];

// Parse an E.164 string into country + local part.
// Matches the longest dial code first to avoid +1 matching +1868, etc.
function parseE164(e164: string): { country: Country; local: string } {
  const fallback = COUNTRIES[0]; // US
  if (!e164.startsWith('+')) return { country: fallback, local: e164.replace(/\D/g, '') };

  const sorted = [...COUNTRIES].sort((a, b) => b.dialCode.length - a.dialCode.length);
  const match = sorted.find((c) => e164.startsWith(c.dialCode));
  if (match) return { country: match, local: e164.slice(match.dialCode.length).replace(/\D/g, '') };
  return { country: fallback, local: e164.slice(1).replace(/\D/g, '') };
}

export function toE164(dialCode: string, local: string): string {
  const digits = local.replace(/\D/g, '');
  return digits ? `${dialCode}${digits}` : '';
}

// Loose E.164 validation: +, then 7–15 digits total.
export function isValidE164(e164: string): boolean {
  return /^\+\d{7,15}$/.test(e164);
}

interface Props {
  value: string;
  onChange: (e164: string) => void;
  placeholder?: string;
  error?: boolean;
  editable?: boolean;
  style?: ViewStyle;
}

export default function PhoneInput({
  value,
  onChange,
  placeholder = '555 000 1234',
  error,
  editable = true,
  style,
}: Props) {
  const parsed = useMemo(() => parseE164(value || ''), []);  // parse once on mount
  const [country, setCountry] = useState<Country>(parsed.country);
  const [localNumber, setLocalNumber] = useState(parsed.local);
  const [showPicker, setShowPicker] = useState(false);
  const [search, setSearch] = useState('');

  // Sync when parent updates the value externally (e.g. ProfileScreen loading from Firestore).
  useEffect(() => {
    if (!value) return;
    const currentE164 = toE164(country.dialCode, localNumber);
    if (value !== currentE164) {
      const reparsed = parseE164(value);
      setCountry(reparsed.country);
      setLocalNumber(reparsed.local);
    }
  // Only re-run when the external value changes, not on internal edits.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleNumberChange = useCallback(
    (text: string) => {
      const digits = text.replace(/\D/g, '');
      setLocalNumber(digits);
      onChange(toE164(country.dialCode, digits));
    },
    [country.dialCode, onChange],
  );

  const handleCountrySelect = useCallback(
    (c: Country) => {
      setCountry(c);
      setShowPicker(false);
      setSearch('');
      onChange(toE164(c.dialCode, localNumber));
    },
    [localNumber, onChange],
  );

  const filtered = useMemo(
    () =>
      search.trim()
        ? COUNTRIES.filter(
            (c) =>
              c.name.toLowerCase().includes(search.toLowerCase()) ||
              c.dialCode.includes(search),
          )
        : COUNTRIES,
    [search],
  );

  return (
    <View style={[styles.container, error && styles.containerError, style]}>
      <TouchableOpacity
        style={styles.countryBtn}
        onPress={() => editable && setShowPicker(true)}
        activeOpacity={editable ? 0.7 : 1}
        hitSlop={{ top: 8, bottom: 8 }}
      >
        <Text style={styles.flag}>{country.flag}</Text>
        <Text style={styles.dialCode}>{country.dialCode}</Text>
        {editable && <Icon name="arrow-drop-down" size={18} color="#6b7280" />}
      </TouchableOpacity>

      <View style={styles.divider} />

      <TextInput
        style={styles.numberInput}
        value={localNumber}
        onChangeText={handleNumberChange}
        placeholder={placeholder}
        placeholderTextColor="#bbb"
        keyboardType="phone-pad"
        editable={editable}
      />

      <Modal
        visible={showPicker}
        animationType="slide"
        transparent
        statusBarTranslucent
        onRequestClose={() => setShowPicker(false)}
      >
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Select Country</Text>
              <TouchableOpacity onPress={() => { setShowPicker(false); setSearch(''); }}>
                <Icon name="close" size={22} color="#374151" />
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Search country or dial code…"
              placeholderTextColor="#9ca3af"
              autoCorrect={false}
              autoCapitalize="none"
            />

            <FlatList
              data={filtered}
              keyExtractor={(item) => item.code}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const selected = country.code === item.code;
                return (
                  <TouchableOpacity
                    style={[styles.countryRow, selected && styles.countryRowSelected]}
                    onPress={() => handleCountrySelect(item)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.rowFlag}>{item.flag}</Text>
                    <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.rowDial}>{item.dialCode}</Text>
                    {selected && <Icon name="check" size={16} color="#4f46e5" />}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  containerError: {
    borderColor: '#ef4444',
  },
  countryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 12,
    gap: 4,
  },
  flag: {
    fontSize: 18,
    lineHeight: 22,
  },
  dialCode: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    minWidth: 32,
  },
  divider: {
    width: 1,
    height: 22,
    backgroundColor: '#e5e7eb',
  },
  numberInput: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111827',
  },
  // Modal
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    paddingBottom: 32,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 18,
    borderBottomWidth: 1,
    borderColor: '#f3f4f6',
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  searchInput: {
    margin: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#111827',
  },
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 12,
    gap: 10,
    borderBottomWidth: 1,
    borderColor: '#f9fafb',
  },
  countryRowSelected: {
    backgroundColor: '#f0f4ff',
  },
  rowFlag: {
    fontSize: 20,
    width: 28,
    textAlign: 'center',
  },
  rowName: {
    flex: 1,
    fontSize: 14,
    color: '#111827',
    fontWeight: '500',
  },
  rowDial: {
    fontSize: 13,
    color: '#6b7280',
    fontWeight: '600',
    marginRight: 4,
  },
});
