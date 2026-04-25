// screens/CreateOrgScreen.tsx
//
// Self-serve org creation form. Collects org + contact details, calls
// POST /orgs/create, then lands the founder on AuthScreen to register.

import React, { useCallback, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/StackNavigator';
import ScreenContainer from '../components/ScreenContainer';
import AppButton from '../components/AppButton';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { PRIMARY_COLOR } from '../src/constants/theme';
import { borderRadius, cardShadow, spacing } from '../src/styles/common';
import { SHUTTLER_API_URL } from '../config';
import { useOrg } from '../src/org/OrgContext';
import type { OrgConfig } from '../src/org/OrgContext';

type Nav = NativeStackNavigationProp<RootStackParamList, 'CreateOrg'>;

// ---- Static option sets ----

const ORG_TYPES = [
  { value: 'university', label: 'University / College' },
  { value: 'k12', label: 'K-12 School' },
  { value: 'corporate', label: 'Corporate Campus' },
  { value: 'healthcare', label: 'Hospital / Healthcare' },
  { value: 'government', label: 'Government / Municipal' },
  { value: 'nonprofit', label: 'Non-profit' },
  { value: 'other', label: 'Other' },
];

const RIDER_RANGES = [
  { value: 'under_50', label: 'Under 50' },
  { value: '50_200', label: '50 – 200' },
  { value: '200_500', label: '200 – 500' },
  { value: '500_plus', label: '500+' },
];

const HEARD_OPTIONS = [
  { value: 'word_of_mouth', label: 'Word of mouth' },
  { value: 'search', label: 'Online search' },
  { value: 'social', label: 'Social media' },
  { value: 'conference', label: 'Conference / event' },
  { value: 'other', label: 'Other' },
];

// ---- Collapsible inline field tooltip ----

function FieldInfo({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={infoStyles.wrap}>
      <TouchableOpacity
        onPress={() => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setOpen((v) => !v);
        }}
        style={infoStyles.trigger}
        hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}
        activeOpacity={0.7}
      >
        <Icon name={open ? 'info' : 'info-outline'} size={15} color={PRIMARY_COLOR} />
        <Text style={infoStyles.triggerText}>{open ? 'Hide' : 'What\'s this?'}</Text>
      </TouchableOpacity>
      {open && (
        <View style={infoStyles.body}>
          <Text style={infoStyles.bodyText}>{text}</Text>
        </View>
      )}
    </View>
  );
}

const infoStyles = StyleSheet.create({
  wrap: { marginTop: -4, marginBottom: 8 },
  trigger: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  triggerText: { fontSize: 12, color: PRIMARY_COLOR, fontWeight: '500' },
  body: {
    backgroundColor: `${PRIMARY_COLOR}0D`,
    borderRadius: borderRadius.md,
    padding: 10,
    marginTop: 6,
  },
  bodyText: { fontSize: 12, color: '#374151', lineHeight: 18 },
});

// ---- Small reusable chip picker ----

function ChipPicker({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={chipStyles.row}>
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <TouchableOpacity
            key={opt.value}
            style={[chipStyles.chip, selected && chipStyles.chipSelected]}
            onPress={() => onChange(opt.value)}
            activeOpacity={0.75}
          >
            <Text style={[chipStyles.chipText, selected && chipStyles.chipTextSelected]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const chipStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: spacing.item,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: borderRadius.lg,
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    backgroundColor: '#fff',
  },
  chipSelected: {
    borderColor: PRIMARY_COLOR,
    backgroundColor: `${PRIMARY_COLOR}12`,
  },
  chipText: {
    fontSize: 13,
    color: '#555',
  },
  chipTextSelected: {
    color: PRIMARY_COLOR,
    fontWeight: '600',
  },
});

// ---- Main screen ----

export default function CreateOrgScreen() {
  const navigation = useNavigation<Nav>();
  const { selectOrg } = useOrg();

  // Contact info
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  // Organisation info
  const [orgName, setOrgName] = useState('');
  const [orgType, setOrgType] = useState('');
  const [website, setWebsite] = useState('');

  // Extra context
  const [estimatedRiders, setEstimatedRiders] = useState('');
  const [heardAboutUs, setHeardAboutUs] = useState('');
  const [description, setDescription] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!firstName.trim() || !lastName.trim()) {
      Alert.alert('Required', 'Please enter your first and last name.');
      return;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      Alert.alert('Required', 'Please enter a valid email address.');
      return;
    }
    if (!orgName.trim()) {
      Alert.alert('Required', 'Please enter an organisation name.');
      return;
    }
    if (!orgType) {
      Alert.alert('Required', 'Please select an organisation type.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`${SHUTTLER_API_URL}/orgs/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactFirstName: firstName.trim(),
          contactLastName: lastName.trim(),
          contactEmail: email.trim().toLowerCase(),
          contactPhone: phone.trim() || undefined,
          orgName: orgName.trim(),
          orgType,
          website: website.trim() || undefined,
          estimatedRiders: estimatedRiders || undefined,
          heardAboutUs: heardAboutUs || undefined,
          description: description.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Failed to create organisation');

      const newOrg = data as OrgConfig;
      await selectOrg(newOrg);
      navigation.navigate('Auth', { orgId: newOrg.orgId });
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [
    firstName, lastName, email, phone,
    orgName, orgType, website,
    estimatedRiders, heardAboutUs, description,
    navigation, selectOrg,
  ]);

  return (
    <ScreenContainer>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Icon name="arrow-back" size={24} color={PRIMARY_COLOR} />
          </TouchableOpacity>
          <View style={styles.headerText}>
            <Text style={styles.title}>Create Organisation</Text>
            <Text style={styles.subtitle}>Start your free 14-day trial</Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.form}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Contact info ── */}
          <Text style={styles.sectionTitle}>Your contact details</Text>

          <View style={styles.row}>
            <View style={styles.halfField}>
              <Text style={styles.label}>First name *</Text>
              <TextInput
                style={styles.input}
                value={firstName}
                onChangeText={setFirstName}
                placeholder="Jane"
                placeholderTextColor="#aaa"
                autoCapitalize="words"
              />
            </View>
            <View style={styles.halfField}>
              <Text style={styles.label}>Last name *</Text>
              <TextInput
                style={styles.input}
                value={lastName}
                onChangeText={setLastName}
                placeholder="Smith"
                placeholderTextColor="#aaa"
                autoCapitalize="words"
              />
            </View>
          </View>

          <Text style={styles.label}>Work email *</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="jane@university.edu"
            placeholderTextColor="#aaa"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.hint}>
            Use the email you'll sign in with. You'll be set as admin automatically.
          </Text>

          <Text style={styles.label}>Phone (optional)</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="+1 (555) 000-0000"
            placeholderTextColor="#aaa"
            keyboardType="phone-pad"
          />
          <FieldInfo text="Used for urgent account communications only. We will never share your number." />

          {/* ── Organisation info ── */}
          <View style={styles.divider} />
          <Text style={styles.sectionTitle}>About your organisation</Text>

          <Text style={styles.label}>Organisation name *</Text>
          <TextInput
            style={styles.input}
            value={orgName}
            onChangeText={setOrgName}
            placeholder="e.g. McKendree University"
            placeholderTextColor="#aaa"
            autoCapitalize="words"
          />

          <Text style={styles.label}>Organisation type *</Text>
          <FieldInfo text={'Determines default features and user roles available to your org.\n• K-12 School — enables parent phone-number sign-in for family tracking.\n• University / College — email or SSO login for students and drivers.\n• Corporate / Healthcare / Government — email or SSO, no parent portal.\nYou can adjust settings later in Org Setup.'} />
          <ChipPicker options={ORG_TYPES} value={orgType} onChange={setOrgType} />

          <Text style={styles.label}>Website (optional)</Text>
          <TextInput
            style={styles.input}
            value={website}
            onChangeText={setWebsite}
            placeholder="https://yourorg.edu"
            placeholderTextColor="#aaa"
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <FieldInfo text="Helps our team verify your organisation during review. Include the full URL (https://…)." />

          {/* ── Extra context ── */}
          <View style={styles.divider} />
          <Text style={styles.sectionTitle}>A bit more context</Text>
          <Text style={styles.hint}>Helps us set up your account correctly. All optional.</Text>

          <Text style={styles.label}>Estimated daily riders</Text>
          <FieldInfo text={'How many unique riders use your shuttle service on a typical day? This helps us recommend the right pricing tier — you can change it any time.\n• Under 50 — Starter plan\n• 50–200 — Growth plan\n• 200–500 — Pro plan\n• 500+ — Enterprise (custom pricing)'} />
          <ChipPicker options={RIDER_RANGES} value={estimatedRiders} onChange={setEstimatedRiders} />

          <Text style={styles.label}>How did you hear about Shuttler?</Text>
          <ChipPicker options={HEARD_OPTIONS} value={heardAboutUs} onChange={setHeardAboutUs} />

          <Text style={styles.label}>Describe your shuttle programme (optional)</Text>
          <FieldInfo text="Tell us about your routes, stops, and operating hours. This helps our setup team pre-configure your account so you're ready to go on day one." />
          <TextInput
            style={[styles.input, styles.textarea]}
            value={description}
            onChangeText={setDescription}
            placeholder="e.g. Campus loop serving 3 dorms and a parking garage, running 7am–10pm weekdays."
            placeholderTextColor="#aaa"
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />

          {/* ── Review notice ── */}
          <View style={styles.reviewNotice}>
            <Icon name="info-outline" size={18} color={PRIMARY_COLOR} style={{ marginTop: 1 }} />
            <Text style={styles.reviewNoticeText}>
              Your trial starts immediately. Paid plans become available once our team reviews your
              account — typically within 1 business day.
            </Text>
          </View>

          <AppButton
            label={isSubmitting ? 'Creating…' : 'Start free trial'}
            onPress={handleSubmit}
            disabled={isSubmitting}
            style={styles.submitBtn}
          />

          <Text style={styles.terms}>
            By continuing you agree to Shuttler's Terms of Service and Privacy Policy.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.section,
    paddingVertical: spacing.item,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  backBtn: {
    padding: 4,
    marginRight: 12,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111',
  },
  subtitle: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
  },
  form: {
    padding: spacing.section,
    paddingBottom: 48,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111',
    marginBottom: spacing.item,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  halfField: {
    flex: 1,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 5,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: borderRadius.md,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 11 : 8,
    fontSize: 15,
    color: '#111',
    backgroundColor: '#fff',
    marginBottom: spacing.item,
  },
  textarea: {
    minHeight: 90,
    paddingTop: 10,
  },
  hint: {
    fontSize: 12,
    color: '#888',
    marginTop: -6,
    marginBottom: spacing.item,
    lineHeight: 17,
  },
  divider: {
    height: 1,
    backgroundColor: '#F0F0F0',
    marginVertical: spacing.section,
  },
  reviewNotice: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: `${PRIMARY_COLOR}10`,
    borderRadius: borderRadius.lg,
    padding: 14,
    marginBottom: spacing.section,
  },
  reviewNoticeText: {
    flex: 1,
    fontSize: 13,
    color: '#374151',
    lineHeight: 19,
  },
  submitBtn: {
    marginBottom: spacing.item,
  },
  terms: {
    fontSize: 11,
    color: '#aaa',
    textAlign: 'center',
    lineHeight: 16,
  },
});
