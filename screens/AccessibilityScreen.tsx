// screens/AccessibilityScreen.tsx
import React from 'react';
import { ScrollView, StyleSheet, Switch, TouchableOpacity, View } from 'react-native'
import { Text } from '../components/Text';

import ScreenContainer from '../components/ScreenContainer';
import HeaderBar from '../components/HeaderBar';
import { useOrgTheme } from '../src/org/useOrgTheme';
import { useAccessibility, type FontScale } from '../src/contexts/AccessibilityContext';
import { cardShadow } from '../src/styles/common';

const FONT_OPTIONS: { label: string; value: FontScale; hint: string }[] = [
  { label: 'Normal', value: 1, hint: 'Default text size' },
  { label: 'Large', value: 1.2, hint: '20% bigger' },
  { label: 'Extra Large', value: 1.4, hint: '40% bigger' },
];

export default function AccessibilityScreen() {
  const { primaryColor } = useOrgTheme();
  const { fontScale, setFontScale, reduceMotion, setReduceMotion } = useAccessibility();

  return (
    <ScreenContainer padded={false}>
      <HeaderBar title="Accessibility" />
      <ScrollView contentContainerStyle={s.content}>

        {/* ── Text Size ── */}
        <Text style={s.sectionLabel}>Text Size</Text>
        <Text style={s.sectionHint}>Affects menu labels and descriptions throughout the app.</Text>

        <View style={s.chipRow}>
          {FONT_OPTIONS.map((opt) => {
            const active = fontScale === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[
                  s.chip,
                  active && { backgroundColor: primaryColor, borderColor: primaryColor },
                ]}
                onPress={() => setFontScale(opt.value)}
                activeOpacity={0.8}
              >
                <Text style={[s.chipLabel, active && s.chipLabelActive]}>{opt.label}</Text>
                <Text style={[s.chipHint, active && s.chipHintActive]}>{opt.hint}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── Live Preview ── */}
        <View style={s.previewCard}>
          <Text style={s.previewHeading}>Preview</Text>
          <View style={s.previewItem}>
            <View style={[s.previewIconBox, { backgroundColor: `${primaryColor}18` }]}>
              <Text style={[s.previewIconText, { color: primaryColor }]}>A</Text>
            </View>
            <View style={s.previewText}>
              <Text style={[s.previewTitle, { fontSize: 16 * fontScale }]}>Menu Item Title</Text>
              <Text style={[s.previewDesc, { fontSize: 14 * fontScale }]}>
                Description text below the title
              </Text>
            </View>
          </View>
          <View style={s.previewDivider} />
          <Text style={[s.previewSmall, { fontSize: 12 * fontScale }]}>
            Smaller label · Like a badge or timestamp
          </Text>
        </View>

        {/* ── Motion ── */}
        <Text style={[s.sectionLabel, { marginTop: 28 }]}>Motion</Text>

        <View style={s.toggleRow}>
          <View style={s.toggleInfo}>
            <Text style={[s.toggleTitle, { fontSize: 15 * fontScale }]}>Reduce motion</Text>
            <Text style={[s.toggleDesc, { fontSize: 13 * fontScale }]}>
              Simplifies slide and spring animations
            </Text>
          </View>
          <Switch
            value={reduceMotion}
            onValueChange={setReduceMotion}
            trackColor={{ false: '#e5e7eb', true: `${primaryColor}60` }}
            thumbColor={reduceMotion ? primaryColor : '#9ca3af'}
          />
        </View>

      </ScrollView>
    </ScreenContainer>
  );
}

const s = StyleSheet.create({
  content: {
    padding: 20,
    paddingBottom: 48,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: 6,
  },
  sectionHint: {
    fontSize: 13,
    color: '#9ca3af',
    marginBottom: 14,
    lineHeight: 18,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  chip: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    backgroundColor: '#fff',
    gap: 4,
  },
  chipLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  chipLabelActive: {
    color: '#fff',
  },
  chipHint: {
    fontSize: 11,
    color: '#9ca3af',
  },
  chipHintActive: {
    color: 'rgba(255,255,255,0.8)',
  },
  previewCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    ...cardShadow,
  },
  previewHeading: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 14,
  },
  previewItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  previewIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  previewIconText: {
    fontSize: 18,
    fontWeight: '700',
  },
  previewText: { flex: 1 },
  previewTitle: {
    fontWeight: '600',
    color: '#0F172A',
    marginBottom: 3,
  },
  previewDesc: {
    color: '#64748B',
  },
  previewDivider: {
    height: 1,
    backgroundColor: '#f3f4f6',
    marginVertical: 12,
  },
  previewSmall: {
    color: '#9ca3af',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    ...cardShadow,
  },
  toggleInfo: { flex: 1, marginRight: 16 },
  toggleTitle: {
    fontWeight: '600',
    color: '#111827',
    marginBottom: 3,
  },
  toggleDesc: {
    color: '#6b7280',
    lineHeight: 18,
  },
});
