// screens/LegalScreen.tsx

import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native'
import { Text } from '../components/Text';
import * as Linking from 'expo-linking';
import Icon from 'react-native-vector-icons/MaterialIcons';
import ScreenContainer from '../components/ScreenContainer';
import HeaderBar from '../components/HeaderBar';
import { useOrgTheme } from '../src/org/useOrgTheme';
import { borderRadius, cardShadow, spacing } from '../src/styles/common';

const TERMS_URL = 'https://shuttler.net/terms';
const PRIVACY_URL = 'https://shuttler.net/privacy';

function LinkCard({
  icon,
  title,
  description,
  url,
  primaryColor,
}: {
  icon: string;
  title: string;
  description: string;
  url: string;
  primaryColor: string;
}) {
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => Linking.openURL(url)}
      activeOpacity={0.85}
    >
      <Icon name={icon} size={28} color={primaryColor} style={styles.cardIcon} />
      <View style={styles.cardText}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardDesc}>{description}</Text>
      </View>
      <Icon name="open-in-new" size={18} color="#9ca3af" />
    </TouchableOpacity>
  );
}

export default function LegalScreen() {
  const { primaryColor } = useOrgTheme();

  return (
    <ScreenContainer padded={false}>
      <HeaderBar title="Legal" />
      <View style={styles.content}>
        <Text style={styles.intro}>
          By using Shuttler you agree to our Terms of Service and Privacy Policy.
          Tap either document to read it in full.
        </Text>

        <LinkCard
          icon="gavel"
          title="Terms of Service"
          description="Rules, responsibilities, and limitations governing your use of Shuttler."
          url={TERMS_URL}
          primaryColor={primaryColor}
        />

        <LinkCard
          icon="privacy-tip"
          title="Privacy Policy"
          description="How we collect, use, and protect your personal information."
          url={PRIVACY_URL}
          primaryColor={primaryColor}
        />

        <Text style={styles.footer}>
          Questions about our legal documents?{'\n'}
          Email us at{' '}
          <Text
            style={[styles.footerLink, { color: primaryColor }]}
            onPress={() => Linking.openURL('mailto:hello@shuttler.net')}
          >
            hello@shuttler.net
          </Text>
        </Text>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    paddingHorizontal: spacing.section,
    paddingTop: spacing.section,
  },
  intro: {
    fontSize: 14,
    color: '#6b7280',
    lineHeight: 21,
    marginBottom: spacing.section * 1.5,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: borderRadius.lg,
    padding: spacing.section,
    marginBottom: spacing.section,
    ...cardShadow,
  },
  cardIcon: {
    marginRight: spacing.section,
  },
  cardText: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 3,
  },
  cardDesc: {
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 18,
  },
  footer: {
    fontSize: 13,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 20,
    marginTop: spacing.section,
  },
  footerLink: {
    fontWeight: '600',
  },
});
