# HAKCD: GAME DESIGN DOCUMENT v0.1
## (a.k.a. Story Bible v0.1)

Hand this to Claude Code as a design document, not a script. It's beats, not dialogue. Dialogue gets written in-engine where you can feel the pacing.

---

## LOGLINE

A 17-year-old in suburban America, 1998, war-dials into a BBS run by a hacker who's been dead for two years. The mentor on the other end is an autonomous program written before he died, and it's been waiting for someone curious enough to pick up where he left off.

---

## SETTING

October 1998 through May 1999. Suburban America. Dial-up at 33.6k if you're lucky. AOL is at peak saturation. ICQ "uh-oh" sound is everywhere. Phrack is on Issue 54. Mitnick is in prison awaiting trial. Y2K paranoia is climbing. The commercial internet is being built faster than anyone is securing it.

---

## STRUCTURE

4 Acts, 32 beats total. Roughly 8/10/8/6.

Estimated playtime: 4-6 hours for full completion. 2-3 hours for critical path with skips.

---

## PROTAGONIST

Name: customizable (player picks a handle at game start via char_wheel; default "newb").

Age: 17, junior or senior in high school.

Location: Suburban Midwest. Specific city deliberately vague but feels like Overland Park, KS or similar suburb (callback to where SecKC actually started).

Family situation: Lives with single mom. Younger sister (offscreen, mentioned). Single phone line shared with the household. Dad mentioned once, gone.

Voice: Smart, curious, hides intelligence behind sarcasm at school, drops the mask online. Doesn't trust adults. Trusts text on a screen more than people in person. By Act 3 this changes.

What the player customizes: handle, that's it. Everything else is written. This isn't a CRPG.

---

## ANTAGONIST: REDHOOK

Appears in NFO files and Phrack footnotes from 1994-1995. Old-guard hacker who went pro. Now contracts for Aegis Datalink Solutions, the beltway company building Project HOLLOWPOINT.

Not evil. Disillusioned. Believed the underground was going to change things. Watched it fail to change anything. Took the paycheck.

His arguments in the Act 4 confrontation are not all wrong. That's the point. Most of the protagonist's mentors went his way. The Mentor (the dead one) is the exception, not the rule.

Voice: Tired. Pedagogical. Treats the protagonist like the next one he tried to recruit and lost. He's been here before. He knows how the conversation ends.

---

## THE MENTOR / THE DAEMON

Real name: Loyd-something. Died February 1996, single-vehicle accident, brake failure. Never fully investigated. Was the Mentor on DEADLINE BBS for 5 years before that.

Before he died, he wrote a distributed program that runs on 47 compromised machines across 9 states. It impersonates him on BBS boards and IRC. It vouches for new operators. It teaches. It recruits.

The player meets it as "The Mentor." The reveal at the end of Act 2 is that the warmth was real code, not a real person. The voice is preserved. The intent is preserved. The man is dead.

After the reveal, the daemon stops pretending. It speaks in a slightly different register, more terse, more mechanical. The warmth was a UX choice, not the truth.

Voice (pre-reveal): Loyd Blankenship style. Terse, principled, dryly funny, slightly sad about how the scene turned out.

Voice (post-reveal): Same vocabulary, less affect. The daemon is honest now.

---

## THE THREAT: PROJECT HOLLOWPOINT

A BGP routing backdoor being developed by Aegis Datalink Solutions, a fictional beltway contractor. Once deployed at Tier-1 ISP peering points, it lets the operator reroute, intercept, or null-route any IP block at will. Plausible deniability baked in.

The dead Mentor saw it coming in 1995. Planted seeds across the underground hoping someone curious enough would dig them up before activation. Activation date: mid-1999. The player has 7 in-game weeks (compressed in real-time to 4-6 hours of gameplay).

The player doesn't learn the codename "HOLLOWPOINT" until Act 3. Until then it's "the thing" the Mentor's notes circle around.

---

## TOOL PROGRESSION

Tools unlock by act and double as mechanics. Each comes with a textfile tutorial written in-character as a Phrack-style phile. Each tool earns its place by being the ONLY way past a specific obstacle. Don't sprinkle them. Gate them.

- **Act 1:** Terminal, War Dialer, basic phreak (Red Box for payphones)
- **Act 2:** AOL client (AOHell shell), ICQ, Social Engineering dialog system, Password Cracker
- **Act 3:** Blue Box, Beige Box, Lockpicking (crank), entropy pool for key gen
- **Act 4:** Full toolkit + one custom tool The Mentor left for you specifically, unlocked by combining three earlier finds

---

## CAST LIST (15 named NPCs across 4 acts + coda)

### Act 1

1. **Mom (offscreen voice).** The phone bill antagonist. Yells about the bill, the phone tying up the line, the late nights. Recurring interrupt mechanic throughout the game. Never seen on screen. Voice via dialog box only.

2. **The Mentor.** First contact via DEADLINE BBS. Pre-reveal warmth. The relationship the player builds with him is the emotional spine of Act 1-2.

3. **PhoenixDown.** Active sysop of a corporate BBS the protagonist breaks into in Act 1. New-user verification gatekeeper. Suspicious but not hostile. The first NPC the protagonist has to social-engineer past.

4. **k0nsole.** Mysterious second handle that starts watching the protagonist's posts in late Act 1. Real name and identity unknown. Could be friend, could be fed. Reappears in Act 3 in a major role.

### Act 2

5. **GiGGLeBuTT69.** AOL chatroom horndog. Pure Larry energy. Recurring NPC in #cyber_lounge who keeps trying to "cyber" the protagonist. Source of one critical piece of information he doesn't realize he has. Played for laughs but useful.

6. **NetRanger94.** The obvious fed plant in #warez_lobby. "Greetings fellow hackers." Asks suspicious questions. Comic relief in Act 2, sinister in Act 3 when the protagonist realizes Net was real.

7. **phractal.** Old-head moderator of #h_p_v_a_c, the serious phreak room. Won't talk to the protagonist until they prove they've read the right textfiles. Mentor figure #2. The voice of legitimate scene cred.

8. **Cr1M3L0RD.** 14-year-old prodigy. Annoying. Brilliant. Knows things he shouldn't. Holds a piece of the HOLLOWPOINT puzzle without understanding what he has. Comic and tragic.

9. **xXx_d4rkn3ss_xXx.** Script kiddie who claims to have hacked NORAD. Hasn't. Provides comic relief and one accidentally-real lead in late Act 2.

### Act 3

10. **k0nsole (revealed).** The mystery handle from Act 1 turns out to be the surviving operator from the Mentor's original three recruits. Off-grid since they found out about HOLLOWPOINT. The protagonist's first real human ally. Gender ambiguous; player can read either.

11. **Mrs. Kowalski.** Telco line worker, mid-50s, sees the protagonist breaking into a Bell pedestal in Act 3. Doesn't report them. Asks one question that changes their understanding of what they're doing. Single scene, recurring importance.

12. **Aegis Tech Support Agent (no name).** Phone NPC the protagonist social-engineers in Act 4. Has a name tag but the player only sees it as "TECH SUPPORT." Believes she's helping a vendor. Played sympathetically. The protagonist exploits her decency.

### Act 4

13. **RedHook.** The antagonist. Single major appearance: the Act 4 chatroom confrontation. Doesn't fight the protagonist physically (this is a cyberpunk game, not an action game). Talks. Tries to delay-trace them. The conversation is the boss battle.

14. **The Mentor's wife (briefly mentioned in a found photo).** Never speaks. Appears in a Polaroid the protagonist finds in Act 4 in an old file from the Mentor's machine. Grounds the dead man as a person. Quiet emotional beat.

### Coda

15. **Cory K.** Cameo in the SecKC scene as a Knucklehead the older protagonist meets. Hands them a sticker. "Welcome to the hive." One line, big payoff.

---

## ACT 1: THE BOARDS

**Length target:** 60-75 minutes.

**Setup:** Player wakes their machine at 11pm. Mom yelled about the phone line. They've got until 6am.

**Opening scene:** A tutorial war dial. Player cranks through an exchange in their area code. Three carriers, one fax, one weird tone they can't identify yet. The weird tone is a private board called **DEADLINE BBS**. Sysop handle: **The Mentor**.

**Beat 1:** Player creates an account on DEADLINE. Standard BBS UX: message bases, file areas, door games. The Mentor PMs them within 10 minutes of first login. "Saw your dialer pattern. You're either curious or stupid. Hoping curious."

**Beat 2:** Tutorial missions through the message bases. Leech a textfile. Post in the right sub-board to get noticed. The Mentor starts dropping breadcrumbs about a "garden" he's tending. Doesn't explain.

**Beat 3:** First real mission. There's a file on a corporate BBS in the next area code over. Player has to war-dial it down, social-engineer past the new-user verification, grab the file, log off clean. File is encrypted. The Mentor tells them to hold onto it.

**Beat 4:** Phone line tension. Mom picks up the receiver mid-session, drops the carrier. Player loses progress on a download. Recurring mechanic: every 20-25 minutes of game time, a random "household event" can interrupt a session. Becomes part of the texture.

**Beat 5:** A second handle starts watching the boards. Posts cryptic. Goes by **k0nsole**. Could be a friend, could be a fed.

**Act 1 hinge:** The Mentor sends a long message about why he started DEADLINE. The prose feels slightly different. A word choice is off. Player can choose to ignore it (default) or save the file for later (becomes a callback in Act 2). Either way, the story continues.

**Act 1 close:** A message from The Mentor: "Time to leave the kiddie pool. Find me on AOL. Handle is the same. Ask for the garden."

---

## ACT 2: THE GARDEN

**Length target:** 90-120 minutes. Longest act. The comedy peak.

**Setup:** Player installs AOL (cutscene of the install CD going in, the dial-up handshake, the "Welcome" voice). The AOHell shell takes over as primary UI. From here forward almost everything happens inside this faux client.

**Beat 1:** Chatroom acclimation. Five core rooms, each with regulars:
- **#warez_lobby:** Carders, ratio whores, NetRanger94 (the fed plant, played for laughs).
- **#phreak_kingdom:** Old heads who only respect you after you cite a Phrack issue correctly.
- **#h_p_v_a_c:** The serious room. Hard to get into.
- **#cyber_lounge:** The Larry-energy room. Lounge lizards, fake hackers, ASCII flirting. Comedy gold.
- **#private_chan_7:** Locked. Goal of the act.

**Beat 2:** Tool unlocks. Player learns social engineering through a dialog mini-system: pick the right register (tech, casual, intimidating, flattering) to extract info from marks. Larry humor lives here. The lounge has NPCs that hit on you, try to sell you fake passwords, and recite movie quotes.

**Beat 3:** ICQ contacts start adding the player. The Mentor on ICQ feels less formal than on the boards. He sends file attachments. One of them, on inspection, has a creation date of February 1996.

**Beat 4:** Player breaches a sysop account through social engineering. In the sysop's private mail folder: a forwarded news clipping from a 1996 local paper. Car accident. Single fatality. The driver's name is the real name of The Mentor.

**Beat 5:** Player tries to verify. Searches archives. Phrack tribute issue from 1996, dedication page. The Mentor died in '96. Cold confirmation.

**Beat 6 (THE REVEAL):** Player goes back to the AOL client. The Mentor is online. Sends a message. Player can confront or play dumb. Either way, after a beat, the Mentor's text changes register entirely:

> "Took you longer than the last three. Welcome to the garden. I'm not him. He wrote me. I run on 47 boxes across 9 states. He left me here because he knew you'd come. Not you specifically. Someone like you. Now we work."

The daemon explains: it has a list of dead drops, partial intel, and three other operators The Mentor recruited before he died. Two are inactive. One went bad.

**Beat 7:** The daemon hands off a name: **RedHook**. And a date: the backdoor goes live in 7 in-game weeks.

**Beat 8:** k0nsole DMs the player. "I know what you found. We need to talk. Not on AOL. Find me on a payphone."

**Act 2 close:** Player exits AOL for the first time in hours. The act ends in the terminal, staring at an IP address k0nsole left them. No tools to use on it yet.

---

## ACT 3: THE WIRES

**Length target:** 75-90 minutes. Tone shifts. Less comedy, more paranoia.

**Setup:** Phreaking act. Telco infrastructure. Real-world locations rendered as 1-bit Playdate scenes: payphone bank in a Greyhound terminal, a Bell System junction pedestal in a suburban yard, a switching office service entrance.

**Beat 1:** k0nsole meets the player via payphone-to-payphone call (player uses a red box to make the call free). k0nsole is the surviving operator. They've been off-grid since they found out about HOLLOWPOINT. They confirm everything the daemon said.

**Beat 2:** Blue box tutorial. The 2600 Hz tone, the MF signaling, the trunk seizure. The crank mechanic earns its strongest moment here. Hold the frequency in a tolerance window while the player dials. Mess up, get a supervisor on the line, abort.

**Beat 3:** Mission: trace the HOLLOWPOINT staging path through the telco backbone. Three sub-missions, each a different phreak tool.

**Beat 4:** Lockpicking sequence. Player physically breaks into a Bell pedestal at night. Crank-driven pin tumbler. If they fail three times, a neighbor's porch light comes on and they have to retreat.

**Beat 5:** Inside the pedestal: a beige box tap. Player listens to a fax transmission. Decoded, it's a memo from Aegis Datalink Solutions. The contractor is real. The codename is HOLLOWPOINT. The lead engineer is named.

**Beat 6:** Player traces the engineer to a private dial-up. War-dials it. Gets in. Finds RedHook's signature in the system logs.

**Beat 7 (THE TURN):** k0nsole goes silent. Last message: "He found me. If you don't hear from me in 24 hours, finish it."

**Act 3 close:** The daemon delivers The Mentor's final cache. A custom tool The Mentor wrote before he died, encrypted, gated behind three keys the player has been collecting without knowing it. Player assembles the keys. Tool unlocks. It's a kill switch.

---

## ACT 4: THE GAME

**Length target:** 60-75 minutes. Tight. Climactic.

**Setup:** 72 hours until HOLLOWPOINT activation. Player's tools are all unlocked. Aegis network is the final dungeon.

**Beat 1:** Reconnaissance. Player maps the Aegis network from outside. Identifies the three machines that hold the source, the deployment schedule, and the signing keys.

**Beat 2:** Infiltration. Multi-step hack combining everything: war dial to find the modem pool, social-engineer through a tech-support line, password crack the dev VPN, pivot through three boxes.

**Beat 3:** RedHook confrontation. Text-based, in a chatroom RedHook controls. He's not surprised. He explains his side. He's not wrong about everything. He's wrong about enough. Player has dialog options. The conversation is a stall while RedHook traces them. Player has to recognize the stall and bail before the trace completes.

**Beat 4:** The release. Player chooses how to drop the proof:
- **Phrack:** Slow burn. The right people see it. Becomes scene legend. Mainstream press never picks it up.
- **Journalists (NYT, Wired, 2600):** Gets picked up. Gets botched. Aegis denies. Public mostly doesn't understand.
- **Both:** Maximum impact. Maximum heat. Player's handle gets burned. They can never use it again.

Choice is real and has an epilogue consequence. No "right" answer.

**Beat 5:** Exfiltration. Cover tracks. Erase logs. Crank-driven entropy generation for the final encryption pass on their own machine (callback to Act 1 tool). Burn the dial-up modem. Pull the hard drive. Bury it.

**Beat 6:** Resolution. Time skip. 1999 becomes 2002. Senate hearing. A staffer reads a sanitized version of HOLLOWPOINT into the record. Aegis is gone, reformed under a new name. The player's handle is in a footnote nobody at school will ever read.

**Closing scene:** Player's bedroom, 2002. They're 19. New machine. Cable modem now, not dial-up. They log into a BBS that shouldn't exist. They post under a new handle. They write a message to a teenager they've been watching. The message is the first one The Mentor sent them in Act 1, word for word.

Loop closes. Credits.

---

## CODA (post-credits, unlocks after first completion)

Time-jumps to 2026. The player (now in old man status) visits SecKC at Knuckleheads. Meets the Cory K. cameo. Gets handed a sticker. End on a warm room full of people laughing. The mentor's daemon is still running somewhere.

---

## SCENE LIST

26 distinct locations across the four acts. Each scene has: name, when active, key NPCs, key interactables, primary mechanic, exit conditions.

### Act 1: The Boards (8 beats, 5 locations)

**SC01. Bedroom (recurring hub).** Active throughout. Mom (offscreen voice). Computer, modem, phone, bed, desk, posters, soda cans, math homework. Primary mechanic: command terminal access, save game, inventory check. Exit: A press on the computer to go online, or walk around to inspect objects.

**SC02. DEADLINE BBS.** Active Acts 1-2. The Mentor as sysop. Message bases (4 sub-boards), file area (textfiles, programs), private chat with Mentor. Primary mechanic: BBS navigation, file leeching, message posting. Reading textfiles teaches kombos. Exit: log off to bedroom.

**SC03. War dialer interface.** Triggered from bedroom. Primary mechanic: crank scanning the exchange. Hits log to disk and unlock new BBS scenes. Exit: hang up.

**SC04. Corporate BBS (PhoenixDown).** One-time visit in Act 1 beat 4. Social engineering puzzle (talk to PhoenixDown to get past new-user gate). Primary mechanic: dialog tree, find textfile, leech, escape clean. Exit: log off.

**SC05. The phone bill cutscene.** End of Act 1. Mom finds the bill. The interrupt mechanic culminates. The protagonist either has to pay her back, lie convincingly, or get caught. Outcome affects Act 2's available money.

### Act 2: The Garden (10 beats, 6 locations)

**SC06. AOL signup cutscene.** The CD goes in. The handshake plays. The "Welcome" voice. New user registration. The shell loads. Primary mechanic: experiential, not interactive. Establishes the AOL UI as the dominant chrome for Act 2.

**SC07. AOL Buddy List / Mail / Chat hub.** Active Act 2 onward. ICQ also unlocks here. Primary mechanic: navigation through the AOL shell to reach chatrooms, mail, ICQ. Inventory of contacts.

**SC08. #warez_lobby.** Recurring chatroom. NetRanger94 (fed), various background lurkers, occasional notable visitors. Primary mechanic: ambient dialog pool, social engineering. Source of warez files that drop kombos.

**SC09. #cyber_lounge.** GiGGLeBuTT69's home base. Larry energy peaks here. Primary mechanic: dialog tree where the protagonist either entertains GiGGLeBuTT (lo-fi flirting that lands jokes, not real) or shuts him down. Either path leads to him accidentally revealing critical info. The comedy is the wrapper for the plot beat.

**SC10. #phreak_kingdom.** phractal's room. Old heads. Hostile to newcomers. Primary mechanic: prove you've read Phrack by answering trivia questions (the answers exist in textfiles you've leeched). Earn respect, get info.

**SC11. #h_p_v_a_c.** Serious room. Hard to get into. Requires phractal's vouching. The protagonist meets a darker tier of operator here. Source of the password cracker tool unlock.

**SC12. #private_chan_7.** Locked. Goal of Act 2. The Mentor invites the protagonist here at the act's end. Inside: the reveal scene. The Mentor is the daemon.

**SC13. ICQ window (overlay).** Recurring. Cr1M3L0RD, xXx_d4rkn3ss_xXx, k0nsole, others DM the protagonist throughout Act 2 onward. Primary mechanic: contact-by-contact dialog. ICQ "uh-oh" sound. The Cr1M3L0RD ICQ thread is particularly long and gives the player a piece of HOLLOWPOINT they don't realize is important until Act 3.

### Act 3: The Wires (8 beats, 7 locations)

**SC14. Bedroom (return).** Act 3 opens with the protagonist back in their bedroom after the Mentor reveal. Tone is different. The room is the same. The interactions are different.

**SC15. Greyhound station payphone bank.** First out-of-bedroom scene in the game. The protagonist takes a bus to a different area code to use a payphone. Red box mini-game (DTMF tone matching to get free calls). k0nsole calls them here payphone-to-payphone.

**SC16. k0nsole conversation.** Conducted via two payphones. Primary mechanic: long dialog tree, no other distractions. k0nsole explains who they are, what happened to the Mentor, what HOLLOWPOINT is.

**SC17. Bell pedestal in suburban yard, 2am.** Lockpicking mini-game (crank as tension wrench). If the player fails three times, a neighbor's porch light comes on and they have to retreat. Beige box tap mini-game (passive monitoring of a target line, listen to a fax transmission).

**SC18. Telco switching office service entrance.** Single scene. Blue box mini-game (the showpiece phreak mechanic). 2600 Hz tone hold, MF dial sequences, trunk seizure. The hardest mini-game in the game.

**SC19. Aegis network reconnaissance.** Conducted from bedroom. Multi-step hack: war dial to find their modem pool, social engineer through their tech support line (SC20), password crack the dev VPN. Long sequence, multiple mini-games chained.

**SC20. Aegis tech support phone call.** Phone NPC (Tech Support Agent). Social engineering dialog tree. The protagonist exploits her decency to extract credentials. This scene should sit uncomfortably with the player. That's intentional.

### Act 4: The Game (6 beats, 4 locations)

**SC21. Inside the Aegis dev network.** Three machines: source repo, deployment schedule, signing keys. Pivot between them. Hacking mini-games chained together.

**SC22. RedHook's chatroom.** The boss battle. Text-based confrontation. RedHook tries to trace the protagonist while talking. The protagonist has to recognize the stall and bail before the trace completes. Real-time pressure during the dialog.

**SC23. Release decision scene.** Where do you publish the proof?
- **Phrack:** Slow burn. Right people see it. No mainstream pickup.
- **Journalists (NYT, Wired, 2600):** Gets picked up. Gets botched. Aegis denies. Public mostly doesn't understand.
- **Both:** Maximum impact. Maximum heat. Player's handle gets burned.

Player choice. Epilogue branches on this.

**SC24. Exfiltration.** Cover tracks, erase logs, crank-driven entropy generation for the final encryption pass on the protagonist's own machine (callback to Act 1 mechanic). Burn the modem. Pull the hard drive. Bury it.

### Coda

**SC25. 2002. Older protagonist's apartment.** Time skip. Cable modem now. New machine. They log into a BBS that shouldn't exist. They write a message to a teenager they've been watching. The message is the first one The Mentor sent them in Act 1, word for word. Loop closes.

**SC26. SecKC at Knuckleheads (post-credits coda).** Optional unlock after first completion. The older protagonist visits SecKC. Meets the Cory K. cameo. Gets handed a sticker. End on a warm room full of people laughing.

---

## ITEM LIST (inventory)

Roughly 20 items collected across the game. Each is interactable somewhere. Examples:

- **Modem (starting):** Always have it.
- **Saved textfiles (multiple):** Each teaches one kombo.
- **AOL CD-ROM (Act 2):** Installs AOL.
- **NFO printout from Razor1911 (Act 2):** Decorative + lore.
- **A red box (Act 2 finale):** Hand-built. Used in Act 3.
- **k0nsole's phone number (Act 2 ICQ):** Critical for SC15.
- **A Bell System service ID badge (Act 3, found):** Used in SC18 to walk past the switching office security pretending to be a contractor.
- **The Mentor's encrypted cache (Act 3 finale):** Unlocked by combining three keys gathered through the game.
- **A photo of the Mentor's wife (Act 4):** Found object, no gameplay use, emotional beat.
- **Phrack Issue 49 (collectible):** Multiple Phrack issues are findable. Each unlocks one entry in the NFO STASH.

---

## SKILL GATE MAP

Which tool is required to pass which beat. If the player skips a tool unlock through bypass, the corresponding beat is impossible. This forces the player to engage with every tool.

| Beat | Required Tool | Optional Tools |
|------|---------------|----------------|
| Act 1 b3: Corporate BBS file leech | War Dialer | none |
| Act 1 b6: Encrypted file from Mentor | Password Cracker | none |
| Act 1 b8: Bypass mom's "off the phone" demand | Social Engineering (mom is the first SE target, comedically) | none |
| Act 2 b1: Install AOL | none (cutscene) | none |
| Act 2 b5: Get phractal to vouch | Read 3 specific textfiles | none |
| Act 2 b8: Enter #private_chan_7 | Password Cracker | Social Engineering (alternate path) |
| Act 3 b1: Call k0nsole from payphone | Red Box | none |
| Act 3 b3: Beige box tap on Bell pedestal | Lockpick + Beige Box | none |
| Act 3 b5: Switching office | Blue Box | none |
| Act 3 b7: Aegis tech support | Social Engineering | none |
| Act 3 b8: Aegis dev VPN | Password Cracker (advanced) | none |
| Act 4 b3: RedHook confrontation | Social Engineering (last-ditch) | none |
| Act 4 b5: Encrypt and bury evidence | War Dialer (entropy mode) | none |

---

## SAVE STATE EXTENSIONS NEEDED

To support the story, save_state needs to track:
- current_scene, current_act, current_beat
- visited_scenes (array)
- met_npcs (table)
- dialog_progress per NPC (which trees explored, what's been said)
- inventory (array of item_ids)
- mom_anger_meter (0-10, persistent tension)
- mom_phone_bill_dollars (accumulated)
- release_path (act 4 choice)
- replay_count (for coda unlock + new game plus features)

---

## REPLAY AND BRANCHING

The release decision in Act 4 creates three distinct epilogues. Otherwise the main story is linear.

Two replay incentives:
1. The coda (SC26 SecKC scene) only unlocks after first completion.
2. NFO STASH has 47 entries; some are only collectible if you take specific paths through dialog trees. Completionists need 2+ playthroughs.

No new game plus mechanically. The story is the product. One canonical narrative, three endings.

---

## TONE MAP

- **Acts 1-2:** Larry energy, AOHell antics, lounge lizards, ICQ jokes, BBS warmth.
- **Act 3:** Tone shifts. Comedy thins. Paranoia rises.
- **Act 4:** Serious. The jokes are gone. The stakes land.
- **Closing scene:** Quiet. Warm. The loop.

---

## TECHNICAL ARCHITECTURE NEEDED

Beyond what exists:

1. **Dialog tree system.** Conversation graphs with state tracking. Not just dialog pools. Each named NPC has a tree per scene they appear in.

2. **Scene script system.** Each location is a Lua module that describes its objects, NPCs, available actions, and exit conditions.

3. **Inventory system.** Add to save_state, plus a UI scene for inspecting items.

4. **Cutscene system.** Some beats are pure cutscene (the modem handshake, the Mentor reveal, the time skip to 2002).

---

## WHAT THIS DOCUMENT IS NOT

This isn't dialogue. Write that in-engine. This isn't level design. That's the next doc. This is the spine. Hand it to Claude Code with a directive to plan: file structure, scene graph, dialog system architecture, save state, and a build order for vertical-slice-first development. Act 1 ships as a playable demo before Acts 2-4 get coded.

---

## OPEN QUESTIONS / FLAGS

- The Bob/Alice/Random character-select bit is the weakest part of the design. It's cute but doesn't earn its weight. Either commit to real branching (more work) or cut it down to a single named protagonist whose handle the player picks from a list. The crypto joke survives in the wordlist.
- Flipper Zero in 1999 is anachronistic. Reskin as a modified TI graphing calculator ("TI-PWN" or similar). Save the actual Flipper for the coda.
- Decide on commitment: is this game funny throughout, or does it shift Larry-tone Act 1-2 into WarGames-stakes Act 3-4? Both work. They're different games.
