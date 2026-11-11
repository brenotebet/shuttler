// src/components/ParentApplicationForm.tsx
// What a parent tells the school when asking to join a K-12 org: their name,
// relationship to the child, and each child's name and grade. An org admin
// checks it (and the SMS-verified phone number) against the school's records
// before approving. Validation mirrors parseParentApplication in
// backend/authPolicy.ts, which is the source of truth.

import React, { useState } from 'react';
import { Platform, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { Text } from '../../components/Text';
import AppButton from '../../components/AppButton';
import { borderRadius, spacing } from '../styles/common';
import { DANGER_COLOR, GRAY_50, GRAY_200, GRAY_400, GRAY_500, GRAY_700, GRAY_900, WHITE } from '../constants/theme';

export type ParentApplication = {
  fullName: string;
  relationship: 'parent' | 'guardian' | 'grandparent' | 'other';
  children: { name: string; grade: string | null }[];
};

const RELATIONSHIPS: { key: ParentApplication['relationship']; label: string }[] = [
  { key: 'parent', label: 'Parent' },
  { key: 'guardian', label: 'Guardian' },
  { key: 'grandparent', label: 'Grandparent' },
  { key: 'other', label: 'Other' },
];

const MAX_CHILDREN = 8;

type Props = {
  primaryColor: string;
  submitting: boolean;
  submitLabel: string;
  initial?: Partial<ParentApplication> | null;
  onSubmit: (application: ParentApplication) => void;
  onCancel?: () => void;
};

export default function ParentApplicationForm({ primaryColor, submitting, submitLabel, initial, onSubmit, onCancel }: Props) {
  const [fullName, setFullName] = useState(initial?.fullName ?? '');
  const [relationship, setRelationship] = useState<ParentApplication['relationship'] | null>(initial?.relationship ?? null);
  const [children, setChildren] = useState<{ name: string; grade: string }[]>(
    initial?.children?.length
      ? initial.children.map((c) => ({ name: c.name, grade: c.grade ?? '' }))
      : [{ name: '', grade: '' }],
  );
  const [error, setError] = useState<string | null>(null);

  const updateChild = (i: number, field: 'name' | 'grade', value: string) =>
    setChildren((prev) => prev.map((c, j) => (j === i ? { ...c, [field]: value } : c)));

  const handleSubmit = () => {
    const name = fullName.replace(/\s+/g, ' ').trim();
    if (name.length < 3 || !name.includes(' ')) return setError('Enter your first and last name.');
    if (!relationship) return setError('Choose your relationship to the child.');
    const kids = children
      .map((c) => ({ name: c.name.replace(/\s+/g, ' ').trim(), grade: c.grade.trim() || null }))
      .filter((c) => c.name);
    if (kids.length === 0) return setError('Add at least one child.');
    if (kids.some((c) => c.name.length < 2)) return setError("Enter each child's full name.");
    setError(null);
    onSubmit({ fullName: name, relationship, children: kids });
  };

  return (
    <View>
      <Text style={styles.intro}>
        Your school checks this, along with your phone number, against its records before you can see the bus.
      </Text>

      <Text style={styles.label}>Your full name</Text>
      <TextInput
        style={styles.input}
        placeholder="First and last name"
        placeholderTextColor={GRAY_400}
        value={fullName}
        onChangeText={setFullName}
        autoCapitalize="words"
        textContentType="name"
      />

      <Text style={styles.label}>Relationship to the child</Text>
      <View style={styles.chips}>
        {RELATIONSHIPS.map(({ key, label }) => {
          const active = relationship === key;
          return (
            <TouchableOpacity
              key={key}
              onPress={() => setRelationship(key)}
              style={[styles.chip, active ? { backgroundColor: primaryColor, borderColor: primaryColor } : null]}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.chipText, { color: active ? WHITE : GRAY_700 }]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.label}>Children you'll track</Text>
      {children.map((child, i) => (
        <View key={i} style={styles.childRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="Child's full name"
            placeholderTextColor={GRAY_400}
            value={child.name}
            onChangeText={(v) => updateChild(i, 'name', v)}
            autoCapitalize="words"
          />
          <TextInput
            style={[styles.input, styles.gradeInput]}
            placeholder="Grade"
            placeholderTextColor={GRAY_400}
            value={child.grade}
            onChangeText={(v) => updateChild(i, 'grade', v)}
          />
          {children.length > 1 && (
            <TouchableOpacity
              onPress={() => setChildren((prev) => prev.filter((_, j) => j !== i))}
              accessibilityLabel="Remove child"
              style={styles.removeBtn}
            >
              <Icon name="close" size={18} color={GRAY_500} />
            </TouchableOpacity>
          )}
        </View>
      ))}
      {children.length < MAX_CHILDREN && (
        <TouchableOpacity onPress={() => setChildren((prev) => [...prev, { name: '', grade: '' }])} style={styles.addBtn}>
          <Icon name="add" size={18} color={primaryColor} />
          <Text style={[styles.addText, { color: primaryColor }]}>Add another child</Text>
        </TouchableOpacity>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      <AppButton
        label={submitting ? 'Sending…' : submitLabel}
        onPress={handleSubmit}
        disabled={submitting}
        style={{ marginTop: spacing.item }}
      />
      {onCancel && (
        <TouchableOpacity onPress={onCancel} style={styles.cancelBtn} disabled={submitting}>
          <Text style={[styles.addText, { color: primaryColor }]}>Cancel</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 13, color: GRAY_500, marginBottom: spacing.item },
  label: { fontSize: 13, fontWeight: '600', color: GRAY_700, marginTop: spacing.item, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: GRAY_200,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.item,
    paddingVertical: Platform.OS === 'ios' ? 13 : 10,
    fontSize: 15,
    color: GRAY_900,
    backgroundColor: GRAY_50,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: GRAY_200, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipText: { fontSize: 14, fontWeight: '600' },
  childRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  gradeInput: { width: 84 },
  removeBtn: { padding: 6 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6 },
  addText: { fontSize: 14, fontWeight: '600' },
  cancelBtn: { alignItems: 'center', paddingTop: spacing.item },
  error: { color: DANGER_COLOR, fontSize: 13, marginTop: spacing.item },
});
