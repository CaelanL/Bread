// lib-ok: spelling equivalence table for lib/align.ts, data only
// A word written two ways and said one way. lib/align.ts folds both sides of a comparison to the
// right-hand spelling, and the result card still shows the verse's own word. Forms that are other
// words (ye, spake, forgat, builded, hath) are not spellings and stay out.

// British and American spellings.
const BRITISH = `
  apparelled>appareled armour>armor armourbearer>armorbearer armoury>armory behaviour>behavior
  behoved>behooved carcase>carcass carcases>carcasses clamour>clamor colour>color
  coloured>colored colours>colors counselled>counseled counsellor>counselor
  counsellors>counselors defence>defense dishonour>dishonor dishonourest>dishonorest
  dishonoureth>dishonoreth distil>distill endeavour>endeavor endeavoured>endeavored
  endeavouring>endeavoring endeavours>endeavors evilfavouredness>evilfavoredness favour>favor
  favourable>favorable favoured>favored favourest>favorest favoureth>favoreth
  fellowlabourer>fellowlaborer fellowlabourers>fellowlaborers fulfil>fulfill fulness>fullness
  honour>honor honourable>honorable honoured>honored honourest>honorest honoureth>honoreth
  honours>honors jailor>jailer labour>labor laboured>labored labourer>laborer labourers>laborers
  laboureth>laboreth labouring>laboring labours>labors licence>license marvelled>marveled
  marvellous>marvelous marvellously>marvelously mitre>miter mouldy>moldy moveable>movable
  neighbour>neighbor neighbours>neighbors nitre>niter odour>odor odours>odors offence>offense
  offences>offenses parlour>parlor parlours>parlors plough>plow practise>practice
  practised>practiced pretence>pretense revellings>revelings rigour>rigor rumour>rumor
  rumours>rumors saviour>savior saviours>saviors savour>savor savourest>savorest savours>savors
  savoury>savory sceptre>scepter sceptres>scepters sepulchre>sepulcher sepulchres>sepulchers
  skilful>skillful skilfully>skillfully skilfulness>skillfulness succour>succor
  succoured>succored succourer>succorer theatre>theater travelled>traveled traveller>traveler
  travellers>travelers travelleth>traveleth travelling>traveling unblameable>unblamable
  unblameably>unblamably unmoveable>unmovable unrebukeable>unrebukable unreproveable>unreprovable
  unsavoury>unsavory unskilful>unskillful valour>valor vapour>vapor vapours>vapors
  wellfavoured>wellfavored wilfully>willfully woollen>woolen
`;

// KJV spellings and today's spelling of the same word.
const ARCHAIC = `
  ancle>ankle ancles>ankles asswage>assuage asswaged>assuaged aul>awl bishoprick>bishopric
  brasen>brazen caterpiller>caterpillar caterpillers>caterpillars chesnut>chestnut cieled>ceiled
  cieling>ceiling cloke>cloak coney>cony coulter>colter coulters>colters crookbackt>crookbacked
  cuckow>cuckoo enquire>inquire enquired>inquired enquirest>inquirest enquiry>inquiry
  fetcht>fetched garlick>garlic grisled>grizzled handywork>handiwork havock>havoc
  heretick>heretic horseleach>horseleech inclosings>enclosings intreat>entreat
  intreated>entreated intreaties>entreaties intreaty>entreaty lothe>loathe lothed>loathed
  lotheth>loatheth lothing>loathing lunatick>lunatic mixt>mixed morter>mortar musick>music
  ospray>osprey pluckt>plucked pourtray>portray pourtrayed>portrayed pransing>prancing
  pransings>prancings publick>public publickly>publicly putrifying>putrefying
  recompence>recompense recompences>recompenses shew>show shewbread>showbread shewed>showed
  shewedst>showedst shewest>showest sheweth>showeth shewing>showing sope>soap spue>spew
  spued>spewed spunge>sponge stedfast>steadfast stedfastly>steadfastly stedfastness>steadfastness
  subtil>subtle subtilly>subtly subtilty>subtlety suretiship>suretyship sycomore>sycamore
  sycomores>sycamores traffick>traffic vail>veil vails>veils villany>villainy
`;

// Names: the KJV's ae and the modern e, Elisabeth and Elizabeth.
const NAMES = `
  alphaeus>alpheus arimathaea>arimathea bartimaeus>bartimeus chaldaeans>chaldeans
  elisabeth>elizabeth epaenetus>epenetus galilaean>galilean galilaeans>galileans
  hymenaeus>hymeneus idumaea>idumea ituraea>iturea judaea>judea lebbaeus>lebbeus
  thaddaeus>thaddeus timaeus>timeus zacchaeus>zaccheus
`;

// Older spellings and names said the same way (Caelan, 2026-11-14).
const BROAD = `
  hungred>hungered rereward>rearward nought>naught bason>basin basons>basins plaister>plaster
  plaistered>plastered jubile>jubilee forbad>forbade sara>sarah juda>judah sion>zion instructer>instructor
`;

// Odd spellings and names the engine wrote in the voice tests (Caelan, 2026-11-15). "hazel" is
// also a KJV word (Genesis 30:37), in by Caelan's call. "enquired" already folds to "inquired".
const VOICE = `
  unseamly>unseemly balam>balaam baala>baalah puteth>putteth fignedly>feignedly enquied>inquired
  eziongebar>eziongeber hazel>hazael knopes>knops hought>houghed mercys>mercies itai>ittai
  lee>leah farefore>therefore
`;

export const SPELLINGS = new Map(
  [BRITISH, ARCHAIC, NAMES, BROAD, VOICE]
    .join(' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((pair) => pair.split('>') as [string, string]),
);
