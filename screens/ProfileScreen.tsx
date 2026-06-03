// screens/ProfileScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { updateProfile, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import Icon from 'react-native-vector-icons/MaterialIcons';

import ScreenContainer from '../components/ScreenContainer';
import HeaderBar from '../components/HeaderBar';
import { auth, db } from '../firebase/firebaseconfig';
import { useAuth } from '../src/auth/AuthProvider';
import { useOrg } from '../src/org/OrgContext';
import { useOrgTheme } from '../src/org/useOrgTheme';
import { showAlert } from '../src/utils/alerts';
import { spacing } from '../src/styles/common';
import PhoneInput from '../src/components/PhoneInput';

function getInitials(name: string | null, email: string | null): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : name.slice(0, 2).toUpperCase();
  }
  if (email) return email[0].toUpperCase();
  return '?';
}

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits[0] === '1') {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return raw;
}

export default function ProfileScreen() {
  const { user, displayName, role, orgId } = useAuth();
  const { org } = useOrg();
  const { primaryColor } = useOrgTheme();

  const [name, setName] = useState(displayName ?? '');
  const [phone, setPhone] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [savingPhone, setSavingPhone] = useState(false);

  // Password change (email auth only)
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [changingPw, setChangingPw] = useState(false);
  const [showPwForm, setShowPwForm] = useState(false);

  const isEmailAuth = org?.authMethod === 'email' || org?.authMethod === 'email+google';
  const isSaml = org?.authMethod === 'saml';
  const email = user?.email ?? null;

  // Load phone from Firestore
  useEffect(() => {
    if (!user?.uid || !orgId) return;
    getDoc(doc(db, 'orgs', orgId, 'users', user.uid)).then((snap) => {
      if (snap.exists()) {
        setPhone(snap.data()?.phone ?? '');
        setName(snap.data()?.displayName ?? displayName ?? '');
      }
    }).catch(() => {});
  }, [user?.uid, orgId]);

  const handleSaveName = async () => {
    const trimmed = name.trim();
    if (!trimmed || !user?.uid || !orgId) return;
    setSavingName(true);
    try {
      if (auth.currentUser) {
        await updateProfile(auth.currentUser, { displayName: trimmed });
      }
      await setDoc(
        doc(db, 'orgs', orgId, 'users', user.uid),
        { displayName: trimmed },
        { merge: true },
      );
      // Keep the public profile in sync so other users (e.g. students tapping
      // a bus marker) see the updated name without requiring a driver re-login.
      await setDoc(
        doc(db, 'orgs', orgId, 'publicUsers', user.uid),
        { displayName: trimmed },
        { merge: true },
      );
      showAlert('Name updated', 'Saved', 'success');
    } catch {
      showAlert('Failed to update name. Please try again.', 'Error', 'error');
    } finally {
      setSavingName(false);
    }
  };

  const handleSavePhone = async () => {
    const trimmed = phone.trim();
    if (!user?.uid || !orgId) return;
    setSavingPhone(true);
    try {
      await setDoc(
        doc(db, 'orgs', orgId, 'users', user.uid),
        { phone: trimmed },
        { merge: true },
      );
      showAlert('Phone number saved', 'Saved', 'success');
    } catch {
      showAlert('Failed to save phone number. Please try again.', 'Error', 'error');
    } finally {
      setSavingPhone(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPw !== confirmPw) {
      showAlert('Passwords do not match.', 'Error', 'error');
      return;
    }
    if (newPw.length < 6) {
      showAlert('New password must be at least 6 characters.', 'Error', 'error');
      return;
    }
    if (!user?.email || !auth.currentUser) return;
    setChangingPw(true);
    try {
      const credential = EmailAuthProvider.credential(user.email, currentPw);
      await reauthenticateWithCredential(auth.currentUser, credential);
      await updatePassword(auth.currentUser, newPw);
      showAlert('Password updated successfully.', 'Saved', 'success');
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
      setShowPwForm(false);
    } catch (e: any) {
      const msg = e?.code === 'auth/wrong-password' || e?.code === 'auth/invalid-credential'
        ? 'Current password is incorrect.'
        : 'Failed to change password. Please try again.';
      showAlert(msg, 'Error', 'error');
    } finally {
      setChangingPw(false);
    }
  };

  const initials = getInitials(displayName, email);

  return (
    <ScreenContainer padded={false}>
      <HeaderBar title="My Profile" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Avatar */}
        <View style={styles.avatarSection}>
          <View style={[styles.avatar, { backgroundColor: primaryColor }]}>
            <Text style={styles.avatarInitials}>{initials}</Text>
          </View>
          <Text style={styles.roleBadge}>{role ?? 'Member'}</Text>
        </View>

        {/* Name */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Display Name</Text>
          <View style={styles.fieldRow}>
            <TextInput
              style={[styles.input, isSaml && styles.inputDisabled]}
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              placeholderTextColor="#9ca3af"
              autoCapitalize="words"
              editable={!isSaml && !savingName}
            />
            {isSaml ? (
              <Icon name="lock" size={18} color="#9ca3af" style={{ marginLeft: 8 }} />
            ) : (
              <TouchableOpacity
                style={[styles.saveBtn, { backgroundColor: primaryColor }, savingName && styles.saveBtnDisabled]}
                onPress={handleSaveName}
                disabled={savingName || !name.trim()}
              >
                {savingName
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Icon name="check" size={18} color="#fff" />}
              </TouchableOpacity>
            )}
          </View>
          {isSaml && (
            <Text style={styles.fieldNote}>Managed by your organization's SSO — contact your IT admin to update.</Text>
          )}
        </View>

        {/* Email */}
        {email && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Email Address</Text>
            <View style={styles.readonlyRow}>
              <Icon name="email" size={16} color="#9ca3af" />
              <Text style={styles.readonlyValue}>{email}</Text>
            </View>
            <Text style={styles.fieldNote}>Email is managed by your account and cannot be changed here.</Text>
          </View>
        )}

        {/* Phone */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Phone Number</Text>
          <View style={styles.fieldRow}>
            <PhoneInput
              value={phone}
              onChange={setPhone}
              editable={!savingPhone}
              style={styles.phoneInput}
            />
            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: primaryColor }, savingPhone && styles.saveBtnDisabled]}
              onPress={handleSavePhone}
              disabled={savingPhone}
            >
              {savingPhone
                ? <ActivityIndicator size="small" color="#fff" />
                : <Icon name="check" size={18} color="#fff" />}
            </TouchableOpacity>
          </View>
          <Text style={styles.fieldNote}>Used for notifications and driver contact. Not shared publicly.</Text>
        </View>

        {/* Change password */}
        {isEmailAuth && (
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.changePasswordRow}
              onPress={() => setShowPwForm((v) => !v)}
            >
              <Icon name="lock" size={18} color={primaryColor} />
              <Text style={[styles.changePasswordLabel, { color: primaryColor }]}>Change Password</Text>
              <Icon name={showPwForm ? 'expand-less' : 'expand-more'} size={20} color="#9ca3af" />
            </TouchableOpacity>

            {showPwForm && (
              <View style={styles.pwForm}>
                <TextInput
                  style={styles.input}
                  value={currentPw}
                  onChangeText={setCurrentPw}
                  placeholder="Current password"
                  placeholderTextColor="#9ca3af"
                  secureTextEntry
                />
                <TextInput
                  style={styles.input}
                  value={newPw}
                  onChangeText={setNewPw}
                  placeholder="New password (min 6 characters)"
                  placeholderTextColor="#9ca3af"
                  secureTextEntry
                />
                <TextInput
                  style={styles.input}
                  value={confirmPw}
                  onChangeText={setConfirmPw}
                  placeholder="Confirm new password"
                  placeholderTextColor="#9ca3af"
                  secureTextEntry
                />
                <TouchableOpacity
                  style={[
                    styles.fullBtn,
                    { backgroundColor: primaryColor },
                    (changingPw || !currentPw || !newPw || !confirmPw) && styles.saveBtnDisabled,
                  ]}
                  onPress={handleChangePassword}
                  disabled={changingPw || !currentPw || !newPw || !confirmPw}
                >
                  {changingPw
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={styles.fullBtnText}>Update Password</Text>}
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: spacing.screenPadding,
    paddingTop: spacing.section,
    paddingBottom: spacing.section * 2,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: spacing.section * 1.5,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  avatarInitials: {
    fontSize: 30,
    fontWeight: '700',
    color: '#fff',
  },
  roleBadge: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'capitalize',
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 16,
    marginBottom: 12,
    gap: 10,
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  phoneInput: {
    flex: 1,
  },
  input: {
    flex: 1,
    backgroundColor: '#f9fafb',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    color: '#111827',
  },
  inputDisabled: {
    color: '#9ca3af',
    backgroundColor: '#f3f4f6',
  },
  saveBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.45 },
  readonlyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  readonlyValue: {
    fontSize: 15,
    color: '#374151',
  },
  fieldNote: {
    fontSize: 12,
    color: '#9ca3af',
    lineHeight: 17,
  },
  changePasswordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  changePasswordLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  pwForm: {
    gap: 10,
    paddingTop: 4,
  },
  fullBtn: {
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  fullBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
});
