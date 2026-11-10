// lib-ok: Reference-only content for Bread's curated collections.
import type { BibleBook } from '@/lib/bible/books';

import type { CollectionIconKey } from './icons';

export interface CollectionPassage {
  book: BibleBook;
  chapter: number;
  verseStart: number;
  verseEnd: number;
}

interface CuratedCollection {
  id: string;
  title: string;
  subtitle: string;
  introduction: string;
  icon: CollectionIconKey;
  // The first passage is the suggested starting point.
  passages: readonly [CollectionPassage, ...CollectionPassage[]];
}

function passage(book: BibleBook, chapter: number, verseStart: number, verseEnd = verseStart): CollectionPassage {
  return { book, chapter, verseStart, verseEnd };
}

export const CURATED_COLLECTIONS: readonly CuratedCollection[] = [
  {
    id: 'anxiety-and-peace',
    title: 'Anxiety & Peace',
    subtitle: 'Words to return to when worry gets loud',
    icon: 'dove',
    introduction:
      'When your thoughts keep returning to the same worry, it can be hard to know what to pray. A verse you know by heart gives you words to bring that worry to God. These passages speak of his care, his presence when you are afraid, and the peace Jesus offers his friends.\n\n' +
      'Start with 1 Peter 5:7. Say it slowly, then name one thing weighing on you and bring it to God in prayer. Try it again while you wait for an appointment or lie awake at night. You can return to the same verse for days. Let the words become familiar enough to reach for when you need them.',
    passages: [
      passage('1 Peter', 5, 7),
      passage('Philippians', 4, 6, 7),
      passage('John', 14, 27),
      passage('Isaiah', 26, 3),
      passage('Psalms', 56, 3, 4),
      passage('Matthew', 6, 34),
      passage('Psalms', 94, 19),
      passage('Psalms', 46, 1),
      passage('Isaiah', 41, 10),
      passage('Colossians', 3, 15),
      passage('Psalms', 4, 8),
      passage('2 Thessalonians', 3, 16),
    ],
  },
  {
    id: 'hope',
    title: 'Hope',
    subtitle: 'Hold on to what God has promised',
    icon: 'sunrise',
    introduction:
      'Hope helps you face what is in front of you while remembering where the story is going. Scripture gives us promises to hold when we cannot see how a situation will turn out. It points us to a faithful God, to the resurrection of Jesus, and to a future he has already begun to secure.\n\n' +
      'Start with Romans 15:13 and pray it for yourself or someone who feels worn down. Notice who gives hope and how Paul asks for it. The next time you find yourself waiting for news or sitting with someone in a hard season, you will have words ready for that moment.',
    passages: [
      passage('Romans', 15, 13),
      passage('Hebrews', 10, 23),
      passage('Romans', 12, 12),
      passage('Lamentations', 3, 22, 23),
      passage('Psalms', 42, 11),
      passage('Psalms', 130, 5),
      passage('1 Peter', 1, 3),
      passage('John', 11, 25, 26),
      passage('Romans', 8, 24, 25),
      passage('2 Corinthians', 4, 16),
      passage('Revelation', 21, 4),
      passage('Titus', 2, 13),
    ],
  },
  {
    id: 'salvation',
    title: 'Salvation',
    subtitle: 'Know the good news well enough to share it',
    icon: 'cross',
    introduction:
      'When someone asks what Christians believe, the clearest place to begin is what God has done through Jesus. These passages trace the good news from our need for forgiveness to the gift of new life. Learn them slowly enough to hear the promise in each one. Over time they give you a way to speak about your faith in your own words, grounded in Scripture.\n\n' +
      'Begin with John 3:16. Notice what God gives, who receives the gift, and what he promises. Then try Ephesians 2:8–9 alongside it. If someone asked you today why you have hope, what would these passages help you say?',
    passages: [
      passage('John', 3, 16),
      passage('Ephesians', 2, 8, 9),
      passage('Romans', 3, 23, 24),
      passage('Romans', 6, 23),
      passage('Romans', 10, 9, 10),
      passage('1 Corinthians', 15, 3, 4),
      passage('Acts', 4, 12),
      passage('Titus', 3, 5),
      passage('John', 5, 24),
      passage('John', 14, 6),
      passage('2 Corinthians', 5, 17),
      passage('1 John', 5, 11, 12),
    ],
  },
  {
    id: 'the-nations',
    title: 'The Nations',
    subtitle: 'Pray beyond the places you know',
    icon: 'globe',
    introduction:
      'From the promises to Abraham to the worship around the throne in Revelation, Scripture keeps widening our view. God intends his blessing to reach people in every nation. These passages help us pray and live with that purpose in mind. They also remind us that the people on the other side of a language, a border, or a culture matter deeply to him.\n\n' +
      'Start with Psalm 67:1–2. Read the two verses together and notice what the blessing is for. Pick one place or people group and pray for them as you practice. Over the next week, let one short passage become a regular way to remember them before God.',
    passages: [
      passage('Psalms', 67, 1, 2),
      passage('Genesis', 12, 2, 3),
      passage('Psalms', 22, 27),
      passage('Psalms', 96, 2, 3),
      passage('Psalms', 117, 1, 2),
      passage('Isaiah', 49, 6),
      passage('Habakkuk', 2, 14),
      passage('Matthew', 28, 19, 20),
      passage('Acts', 1, 8),
      passage('Romans', 10, 14, 15),
      passage('Revelation', 5, 9),
      passage('Revelation', 7, 9),
    ],
  },
  {
    id: 'spiritual-warfare',
    title: 'Spiritual Warfare',
    subtitle: 'Have Scripture ready when temptation comes',
    icon: 'shield',
    introduction:
      'A tempting thought can sound persuasive in the moment. Jesus answered temptation with words from Scripture, and Paul describes the word of God as part of the armor believers are given. Memorizing these passages prepares you to remember what is true when your attention is pulled toward fear, accusation, or an easy compromise.\n\n' +
      'Begin with Ephesians 6:10–11 and read the rest of the armor passage around it. As you practice, pay attention to whose strength Paul tells us to rely on. Then learn one passage that speaks to a temptation you recognize in your own life. Practice saying it before the moment comes.',
    passages: [
      passage('Ephesians', 6, 10, 11),
      passage('Ephesians', 6, 12),
      passage('Ephesians', 6, 16, 17),
      passage('James', 4, 7, 8),
      passage('1 Peter', 5, 8, 9),
      passage('1 John', 2, 14),
      passage('1 John', 4, 4),
      passage('Matthew', 4, 4),
      passage('Psalms', 119, 11),
      passage('2 Corinthians', 10, 4, 5),
      passage('1 Corinthians', 10, 13),
      passage('Romans', 13, 14),
    ],
  },
  {
    id: 'trusting-god',
    title: 'Trusting God',
    subtitle: 'Remember who holds you when the way is unclear',
    icon: 'mountain',
    introduction:
      'Some decisions leave you with more questions than answers. Scripture gives you a place to stand while you make a choice, wait for clarity, or take the next faithful step. These verses point to the character of God and show how people have turned to him with real uncertainty. Read them with the particulars of your life in mind.\n\n' +
      'Start with Proverbs 3:5–6. Practice the two verses together, then pray about one part of your day where you are relying on your own understanding. Come back to the passage when you feel the need to have everything settled. A few familiar words can help you remember who is with you on the way.',
    passages: [
      passage('Proverbs', 3, 5, 6),
      passage('Psalms', 56, 3, 4),
      passage('Psalms', 37, 5),
      passage('Psalms', 62, 8),
      passage('Psalms', 121, 1, 2),
      passage('Psalms', 23, 1, 2),
      passage('Isaiah', 40, 31),
      passage('Jeremiah', 17, 7, 8),
      passage('Nahum', 1, 7),
      passage('Romans', 8, 28),
      passage('2 Corinthians', 5, 7),
      passage('Hebrews', 13, 5, 6),
    ],
  },
  {
    id: 'prayer',
    title: 'Prayer',
    subtitle: 'Let Scripture give shape to your prayers',
    icon: 'prayer',
    introduction:
      'Some days you know exactly what you want to bring to God. Other days you sit quietly and wonder where to start. These passages help you enter that conversation. They give you language for asking, confessing, thanking, and remembering that God hears you. Over time, the words you learn can also become prayers for the people you love.\n\n' +
      'Start with Hebrews 4:16. Notice the invitation to come to God when you need mercy and help. Try praying through one memorized verse in your own words before you move on to the next. You can do that walking to your car, waiting in line, or sitting quietly at the start of the day.',
    passages: [
      passage('Hebrews', 4, 16),
      passage('Philippians', 4, 6, 7),
      passage('Matthew', 6, 9, 10),
      passage('Matthew', 6, 11, 12),
      passage('Matthew', 7, 7, 8),
      passage('John', 15, 7),
      passage('1 John', 5, 14, 15),
      passage('Psalms', 19, 14),
      passage('Psalms', 139, 23, 24),
      passage('Psalms', 51, 10),
      passage('Romans', 8, 26),
      passage('Colossians', 4, 2),
    ],
  },
  {
    id: 'gods-love',
    title: 'God’s Love',
    subtitle: 'Remember how God has loved you in Christ',
    icon: 'heart',
    introduction:
      'It is easy to measure how loved we are by how the day went, what we accomplished, or how someone responded to us. These passages bring our attention back to the ways God has shown his love in Christ. They give us words to remember when we feel unworthy and words to share when someone else needs assurance.\n\n' +
      'Start with Romans 5:8. Notice when God acted and what he did. As you learn the other passages, pay attention to how God’s love becomes a pattern for the way we treat people. Choose one person you can encourage this week with something you have remembered.',
    passages: [
      passage('Romans', 5, 8),
      passage('John', 3, 16),
      passage('Romans', 8, 38, 39),
      passage('1 John', 4, 9, 10),
      passage('1 John', 3, 1),
      passage('1 John', 4, 19),
      passage('John', 15, 9, 10),
      passage('John', 15, 12, 13),
      passage('Ephesians', 3, 18, 19),
      passage('Psalms', 103, 11, 12),
      passage('Zephaniah', 3, 17),
      passage('Galatians', 2, 20),
    ],
  },
  {
    id: 'wisdom',
    title: 'Wisdom',
    subtitle: 'Carry good counsel into everyday choices',
    icon: 'lamp',
    introduction:
      'Wisdom becomes practical when you are about to answer a hard question, choose how to spend your time, or decide what kind of advice to follow. These passages give you short pieces of counsel that you can carry into those ordinary decisions. They help you slow down long enough to listen and ask what faithfulness looks like here.\n\n' +
      'Start with James 1:5. Bring one real choice before God and ask him for wisdom as you practice the verse. Then learn a passage about listening or speaking and try recalling it before your next difficult conversation. See what changes when the words are already in your mind.',
    passages: [
      passage('James', 1, 5),
      passage('Proverbs', 9, 10),
      passage('Proverbs', 4, 23),
      passage('Proverbs', 15, 1),
      passage('Proverbs', 13, 20),
      passage('Proverbs', 16, 9),
      passage('Proverbs', 18, 13),
      passage('Psalms', 90, 12),
      passage('Psalms', 119, 105),
      passage('James', 1, 19, 20),
      passage('James', 3, 17),
      passage('Ephesians', 5, 15, 16),
    ],
  },
  {
    id: 'gratitude-and-joy',
    title: 'Gratitude & Joy',
    subtitle: 'Make room to notice God’s goodness',
    icon: 'sun',
    introduction:
      'A good gift can pass by before we have stopped to notice it. These passages make space to remember God’s goodness and give thanks for what he has done. Some are words of celebration. Others were written by people who knew hardship and still had reasons to rejoice. Together they give you something to say in a range of seasons.\n\n' +
      'Begin with Psalm 100:4–5. Let the reasons for thanksgiving in the last verse shape your own prayer. Try saying the passage at the end of the day, then name one good thing you received. When thanks feels difficult, you can start by recalling one thing the passage tells you about God.',
    passages: [
      passage('Psalms', 100, 4, 5),
      passage('Philippians', 4, 4),
      passage('1 Thessalonians', 5, 16, 17),
      passage('1 Thessalonians', 5, 18),
      passage('Psalms', 103, 1, 2),
      passage('Psalms', 118, 24),
      passage('Psalms', 16, 11),
      passage('Psalms', 126, 3),
      passage('John', 15, 11),
      passage('Colossians', 3, 16, 17),
      passage('James', 1, 17),
      passage('Habakkuk', 3, 18, 19),
    ],
  },
];
