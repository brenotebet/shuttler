// screens/AdminChatScreen.tsx
import React, { useState, useRef, useCallback } from 'react';
import { View, TextInput, FlatList, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native'
import { Text } from '../components/Text';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialIcons';

import { auth } from '../firebase/firebaseconfig';
import { SHUTTLER_API_URL } from '../config';
import { useOrg } from '../src/org/OrgContext';
import { useAuth } from '../src/auth/AuthProvider';
import { useOrgTheme } from '../src/org/useOrgTheme';
import ScreenContainer from '../components/ScreenContainer';
import {
  WHITE,
  GRAY_50,
  GRAY_100,
  GRAY_200,
  GRAY_400,
  GRAY_500,
  GRAY_700,
  GRAY_900,
} from '../src/constants/theme';
import { borderRadius } from '../src/styles/common';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTED_ADMIN = [
  'Which stop has the most pickups?',
  'How do I add a new driver?',
  'How do I create a new route?',
  'What does my boarding data show?',
];

const SUGGESTED_DRIVER = [
  'How do I start my shift?',
  'How do I record a boarding?',
  'What stops are on my route?',
  'How do I end my shift?',
];

const SUGGESTED_RIDER = [
  'How do I request a pickup?',
  'How do I track the shuttle?',
  'What stops are available?',
  'How do I cancel a request?',
];

// The model replies in light markdown; the bubble is a plain <Text>, so render
// **bold** spans as nested bold Text instead of showing literal asterisks.
function renderInlineBold(content: string): React.ReactNode {
  // Render "# Heading" lines as bold text rather than literal hash marks.
  const normalized = content.replace(/^#{1,6}\s+(.+)$/gm, '**$1**');
  const parts = normalized.split(/\*\*(.+?)\*\*/g);
  if (parts.length === 1) return normalized;
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <Text key={i} style={{ fontWeight: '700' }}>
        {part}
      </Text>
    ) : (
      part
    ),
  );
}

function getSuggested(role: string | null): string[] {
  if (role === 'admin') return SUGGESTED_ADMIN;
  if (role === 'driver') return SUGGESTED_DRIVER;
  return SUGGESTED_RIDER;
}

export default function AdminChatScreen() {
  const navigation = useNavigation();
  const { org } = useOrg();
  const { role } = useAuth();
  const { primaryColor } = useOrgTheme();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const listRef = useRef<FlatList>(null);
  const suggested = getSuggested(role);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: trimmed };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setLoading(true);

    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);

    const apiMessages = next.map((m) => ({ role: m.role, content: m.content }));
    const orgId = org?.orgId;

    const callChat = async (forceTokenRefresh: boolean) => {
      const token = await auth.currentUser?.getIdToken(forceTokenRefresh);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);
      try {
        const res = await fetch(`${SHUTTLER_API_URL}/ai/admin-chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ orgId, messages: apiMessages }),
          signal: controller.signal,
        });
        const data = await res.json().catch(() => ({}));
        return { res, data };
      } finally {
        clearTimeout(timeoutId);
      }
    };

    try {
      if (!orgId) throw new Error('No organization selected. Try signing out and back in.');

      let { res, data } = await callChat(false);

      // A cached session token can carry stale org-membership claims; one forced
      // refresh recovers from that without surfacing a confusing error.
      if (res.status === 403) {
        ({ res, data } = await callChat(true));
      }

      if (!res.ok) {
        const message = res.status === 429
          ? "You've reached today's question limit. Please try again tomorrow."
          : data?.message ?? data?.error ?? 'The assistant hit an error. Please try again.';
        throw new Error(message);
      }

      const reply = data.reply?.trim() || 'Sorry, I couldn\'t get a response. Please try again.';

      setMessages((prev) => [
        ...prev,
        { id: (Date.now() + 1).toString(), role: 'assistant', content: reply },
      ]);
    } catch (err: any) {
      console.error('[AdminChatScreen] send failed:', err);
      const message = err?.name === 'AbortError'
        ? 'The request timed out. Please check your connection and try again.'
        : err?.message || 'Something went wrong. Please check your connection and try again.';
      setMessages((prev) => [
        ...prev,
        { id: (Date.now() + 1).toString(), role: 'assistant', content: message },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    }
  }, [messages, loading, org?.orgId]);

  const renderMessage = ({ item }: { item: Message }) => {
    const isUser = item.role === 'user';
    return (
      <View style={[styles.row, isUser ? styles.rowUser : styles.rowAssistant]}>
        {!isUser && (
          <View style={[styles.aiBadge, { backgroundColor: primaryColor }]}>
            <Icon name="auto-awesome" size={12} color={WHITE} />
          </View>
        )}
        <View style={[
          styles.bubble,
          isUser
            ? [styles.bubbleUser, { backgroundColor: primaryColor }]
            : styles.bubbleAssistant,
        ]}>
          <Text style={[styles.bubbleText, isUser ? styles.bubbleTextUser : styles.bubbleTextAssistant]}>
            {renderInlineBold(item.content)}
          </Text>
        </View>
      </View>
    );
  };

  const isEmpty = messages.length === 0;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <ScreenContainer style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Icon name="arrow-back" size={22} color={GRAY_700} />
          </TouchableOpacity>
          <View style={styles.headerText}>
            <Text style={styles.headerTitle}>AI Assistant</Text>
          </View>
          <View style={[styles.aiBadgeLarge, { backgroundColor: primaryColor }]}>
            <Icon name="auto-awesome" size={16} color={WHITE} />
          </View>
        </View>

        {/* Messages or empty state */}
        {isEmpty ? (
          <View style={styles.emptyState}>
            <View style={[styles.emptyIcon, { backgroundColor: `${primaryColor}15` }]}>
              <Icon name="auto-awesome" size={32} color={primaryColor} />
            </View>
            <Text style={styles.emptyTitle}>Ask me anything</Text>
            <Text style={styles.emptySubtitle}>
              {role === 'admin'
                ? 'I know your stops, routes, and boarding data. Ask about your operations or how to use the app.'
                : 'I can help you navigate the app, find your stops, and understand how the shuttle works.'}
            </Text>
            <View style={styles.suggestions}>
              {suggested.map((q) => (
                <TouchableOpacity
                  key={q}
                  style={[styles.suggestion, { borderColor: `${primaryColor}40` }]}
                  onPress={() => send(q)}
                >
                  <Text style={[styles.suggestionText, { color: primaryColor }]}>{q}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={renderMessage}
            contentContainerStyle={styles.messageList}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          />
        )}

        {/* Thinking indicator */}
        {loading && (
          <View style={styles.thinkingRow}>
            <View style={[styles.aiBadge, { backgroundColor: primaryColor }]}>
              <Icon name="auto-awesome" size={12} color={WHITE} />
            </View>
            <View style={styles.thinkingBubble}>
              <ActivityIndicator size="small" color={primaryColor} />
              <Text style={[styles.thinkingText, { color: primaryColor }]}>Thinking…</Text>
            </View>
          </View>
        )}

        {/* AI disclosure (App Review: AI-generated content) */}
        <Text style={styles.aiDisclaimer}>
          Responses are generated by AI and may be inaccurate. Verify shuttle times and operational details in the app before acting on them.
        </Text>

        {/* Input bar */}
        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Ask a question…"
            placeholderTextColor={GRAY_400}
            multiline
            maxLength={500}
            returnKeyType="send"
            onSubmitEditing={() => send(input)}
            blurOnSubmit
          />
          <TouchableOpacity
            style={[styles.sendBtn, { backgroundColor: input.trim() && !loading ? primaryColor : GRAY_200 }]}
            onPress={() => send(input)}
            disabled={!input.trim() || loading}
          >
            <Icon name="send" size={18} color={input.trim() && !loading ? WHITE : GRAY_400} />
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  aiDisclaimer: {
    fontSize: 11,
    color: GRAY_400,
    lineHeight: 15,
    textAlign: 'center',
    paddingHorizontal: 20,
    paddingTop: 6,
  },
  container: { flex: 1, paddingHorizontal: 0, paddingTop: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: GRAY_100,
    backgroundColor: WHITE,
    gap: 12,
  },
  backBtn: { padding: 4 },
  headerText: { flex: 1 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: GRAY_900 },
  aiBadgeLarge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
  },
  messageList: { padding: 16, paddingBottom: 8 },
  row: { flexDirection: 'row', marginBottom: 12, alignItems: 'flex-end', gap: 8 },
  rowUser: { justifyContent: 'flex-end' },
  rowAssistant: { justifyContent: 'flex-start' },
  aiBadge: {
    width: 24,
    height: 24,
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
    marginBottom: 2,
  },
  bubble: {
    maxWidth: '80%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: borderRadius.lg,
  },
  bubbleUser: { borderBottomRightRadius: 4 },
  bubbleAssistant: { backgroundColor: GRAY_100, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  bubbleTextUser: { color: WHITE },
  bubbleTextAssistant: { color: GRAY_900 },
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  thinkingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: GRAY_100,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: borderRadius.lg,
    borderBottomLeftRadius: 4,
  },
  thinkingText: { fontSize: 13, fontWeight: '500' },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 10,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: GRAY_100,
    backgroundColor: WHITE,
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: GRAY_50,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: GRAY_900,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: GRAY_200,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.xl,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyState: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 18,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: GRAY_900,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: GRAY_500,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 28,
    maxWidth: 300,
  },
  suggestions: { gap: 10, width: '100%' },
  suggestion: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: WHITE,
  },
  suggestionText: { fontSize: 14, fontWeight: '500' },
});
