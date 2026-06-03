// src/components/PickupConfirmModal.tsx
import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import BottomSheet from '../../components/BottomSheet';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { addDoc, collection, serverTimestamp, updateDoc, doc } from 'firebase/firestore';
import { db } from '../../firebase/firebaseconfig';
import { showAlert } from '../utils/alerts';

export const FEEDBACK_ENABLED_KEY = 'shuttler_feedback_enabled';

interface Props {
  visible: boolean;
  requestId: string;
  orgId: string;
  studentUid: string;
  stopName: string;
  primaryColor: string;
  onDone: () => void;
}

type Question =
  | { key: string; question: string; type: 'stars' }
  | { key: string; question: string; type: 'options'; options: string[] };

const QUESTION_POOL: Question[] = [
  { key: 'eta_accuracy',       question: 'How accurate was the ETA?',           type: 'stars' },
  { key: 'service_rating',     question: 'How was the driver\'s service?',       type: 'stars' },
  { key: 'overall_experience', question: 'How would you rate this ride overall?', type: 'stars' },
  { key: 'app_ease',           question: 'How easy was it to use the app?',      type: 'stars' },
  { key: 'punctuality',
    question: 'Was the shuttle on time?',
    type: 'options',
    options: ['Early', 'On time', 'A bit late', 'Very late'],
  },
  { key: 'would_use_again',
    question: 'Would you use Shuttler again?',
    type: 'options',
    options: ['Definitely', 'Probably', 'Not sure', 'No'],
  },
  { key: 'wait_time',
    question: 'How was the wait time at your stop?',
    type: 'options',
    options: ['Very short', 'Reasonable', 'A bit long', 'Too long'],
  },
];

export default function PickupConfirmModal({
  visible,
  requestId,
  orgId,
  studentUid,
  stopName,
  primaryColor,
  onDone,
}: Props) {
  const [step, setStep] = useState<'confirm' | 'feedback'>('confirm');
  const [selectedRating, setSelectedRating] = useState<number | null>(null);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const question = useMemo(
    () => QUESTION_POOL[Math.floor(Math.random() * QUESTION_POOL.length)],
    // pick once when modal becomes visible
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible],
  );

  const handleNotYet = async () => {
    setSaving(true);
    try {
      await updateDoc(doc(db, 'orgs', orgId, 'stopRequests', requestId), {
        status: 'pending',
        confirmationExpiresAtMs: null,
      });
      showAlert('Got it — your request is still active and the driver will see it.', 'Still waiting', 'info');
    } catch {
      showAlert('Something went wrong. Please try again.', 'Error', 'error');
    } finally {
      setSaving(false);
      onDone();
    }
  };

  const handleConfirmedPickup = async () => {
    const val = await AsyncStorage.getItem(FEEDBACK_ENABLED_KEY);
    const feedbackEnabled = val !== 'false';
    if (feedbackEnabled) {
      setStep('feedback');
    } else {
      saveFeedbackAndComplete();
    }
  };

  const saveFeedbackAndComplete = async (rating?: number, answer?: string) => {
    setSaving(true);
    try {
      await updateDoc(doc(db, 'orgs', orgId, 'stopRequests', requestId), {
        status: 'completed',
        completedAt: serverTimestamp(),
        completedReason: 'rider_confirmed',
      });

      if (rating !== undefined || answer !== undefined) {
        await addDoc(collection(db, 'orgs', orgId, 'feedback'), {
          studentUid,
          requestId,
          questionKey: question.key,
          question: question.question,
          ...(rating !== undefined ? { rating } : {}),
          ...(answer !== undefined ? { answer } : {}),
          createdAt: serverTimestamp(),
        });
        showAlert('Thanks for the feedback!', 'Done', 'success');
      } else {
        showAlert('Ride completed. Have a great day!', 'Done', 'success');
      }
    } catch {
      showAlert('Something went wrong. Please try again.', 'Error', 'error');
    } finally {
      setSaving(false);
      onDone();
    }
  };

  const handleSkip = () => saveFeedbackAndComplete();

  const handleSubmitFeedback = () => {
    if (question.type === 'stars' && selectedRating !== null) {
      saveFeedbackAndComplete(selectedRating);
    } else if (question.type === 'options' && selectedOption !== null) {
      saveFeedbackAndComplete(undefined, selectedOption);
    }
  };

  const canSubmit = question.type === 'stars' ? selectedRating !== null : selectedOption !== null;

  return (
    <BottomSheet visible={visible} onClose={() => {}} sheetStyle={styles.sheet}>
          {/* Handle */}
          <View style={styles.handle} />

          {step === 'confirm' ? (
            <>
              <View style={[styles.iconCircle, { backgroundColor: `${primaryColor}18` }]}>
                <Icon name="directions-bus" size={40} color={primaryColor} />
              </View>

              <Text style={styles.title}>Were you picked up?</Text>
              <Text style={styles.subtitle}>
                The driver marked a boarding at{'\n'}
                <Text style={{ fontWeight: '700' }}>{stopName}</Text>
              </Text>

              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: primaryColor }]}
                onPress={handleConfirmedPickup}
                disabled={saving}
              >
                <Icon name="check-circle" size={20} color="#fff" />
                <Text style={styles.primaryBtnText}>Yes, I'm on the bus!</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={handleNotYet}
                disabled={saving}
              >
                {saving
                  ? <ActivityIndicator size="small" color="#6b7280" />
                  : <Text style={styles.secondaryBtnText}>No, not yet</Text>}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={[styles.iconCircle, { backgroundColor: '#fef9c3' }]}>
                <Icon name="star" size={38} color="#f59e0b" />
              </View>

              <Text style={styles.title}>Quick feedback</Text>
              <Text style={styles.questionText}>{question.question}</Text>

              {question.type === 'stars' && (
                <View style={styles.starsRow}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <TouchableOpacity
                      key={n}
                      onPress={() => setSelectedRating(n)}
                      style={styles.starBtn}
                    >
                      <Icon
                        name={selectedRating !== null && n <= selectedRating ? 'star' : 'star-border'}
                        size={38}
                        color={selectedRating !== null && n <= selectedRating ? '#f59e0b' : '#d1d5db'}
                      />
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {question.type === 'options' && (
                <View style={styles.optionsGrid}>
                  {(question as any).options.map((opt: string) => (
                    <TouchableOpacity
                      key={opt}
                      style={[
                        styles.optionBtn,
                        selectedOption === opt && { backgroundColor: primaryColor, borderColor: primaryColor },
                      ]}
                      onPress={() => setSelectedOption(opt)}
                    >
                      <Text style={[
                        styles.optionBtnText,
                        selectedOption === opt && { color: '#fff' },
                      ]}>
                        {opt}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <View style={styles.feedbackActions}>
                <TouchableOpacity
                  style={[
                    styles.submitBtn,
                    { backgroundColor: primaryColor },
                    (!canSubmit || saving) && styles.btnDisabled,
                  ]}
                  onPress={handleSubmitFeedback}
                  disabled={!canSubmit || saving}
                >
                  {saving
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={styles.submitBtnText}>Submit</Text>}
                </TouchableOpacity>

                <TouchableOpacity style={styles.skipBtn} onPress={handleSkip} disabled={saving}>
                  <Text style={styles.skipBtnText}>Skip</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    padding: 28,
    paddingBottom: 44,
    alignItems: 'center',
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#e5e7eb',
    borderRadius: 2,
    marginBottom: 24,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  questionText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#374151',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 24,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    paddingVertical: 16,
    borderRadius: 14,
    justifyContent: 'center',
    marginBottom: 12,
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  secondaryBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6b7280',
  },
  starsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 32,
  },
  starBtn: {
    padding: 4,
  },
  optionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'center',
    marginBottom: 28,
    width: '100%',
  },
  optionBtn: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    backgroundColor: '#f9fafb',
  },
  optionBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  feedbackActions: {
    width: '100%',
    gap: 10,
  },
  submitBtn: {
    width: '100%',
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
  },
  submitBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  skipBtn: {
    width: '100%',
    paddingVertical: 12,
    alignItems: 'center',
  },
  skipBtnText: {
    fontSize: 14,
    color: '#9ca3af',
    fontWeight: '500',
  },
  btnDisabled: { opacity: 0.4 },
});
