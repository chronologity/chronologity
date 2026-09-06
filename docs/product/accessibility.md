# Chronologity Accessibility

## Purpose

This document defines the product accessibility requirements for Chronologity.

Accessibility is a foundational product property, not a later compatibility layer. Chronologity's defining experiences---vertical chronology, horizontal historical context, depth into Moments, temporal zoom, historical jumps, image and video media, social interaction, Search, Discovery, and historical navigation---must remain understandable and operable for Users who cannot perceive or interact with the product in the default visual, spatial, auditory, motion-based, or touch-based ways.

The central question is:

> **How should Chronologity preserve the meaning, navigation, and historical context of its spatial and media-rich experience when a User cannot rely on vision, hearing, motion, precise gestures, color, or any single interaction modality?**

This document defines product behavior and invariants rather than platform-specific accessibility APIs, React Native implementation details, semantic component libraries, automated testing tools, WCAG conformance procedures, or assistive-technology engineering.

## Core Principle

Chronologity must preserve the distinction:

```text
Presentation
    !=
Meaning
```

Chronologity may present history spatially, visually, through motion, through media, and through gesture.

But the meaning of that history cannot depend exclusively on any of those mechanisms.

If the visual Timeline communicates:

```text
vertical position   -> chronology
horizontal position -> contextual relationship
depth               -> focus within a Moment
zoom level          -> temporal scale
```

then an accessible representation must communicate those same semantics without requiring the User to infer them visually.

Accessibility does not require every User to experience identical presentation.

It requires equivalent access to the product's meaning, capabilities, and historical context.

## Accessibility Is a Day-One Requirement

Accessibility must be considered in the initial product architecture and interaction model.

Chronologity should not build a gesture-heavy, spatial Timeline first and attempt to retrofit semantics afterward.

Day-one accessibility applies to:

- account creation and authentication;
- User profiles;
- Moment creation;
- Moment viewing;
- media upload;
- media viewing;
- Timeline navigation;
- temporal zoom;
- historical jumps;
- Feed navigation;
- Search;
- Discovery;
- Comments;
- Reactions;
- notifications;
- privacy controls;
- reporting;
- moderation notices;
- appeals;
- settings;
- and other launch-critical workflows.

## Equivalent Experience

Equivalent accessibility does not mean pixel-for-pixel or interaction-for-interaction duplication.

For example, a sighted User may understand chronology from vertical spatial position.

A screen-reader User may instead hear:

```text
August 10, 2026
Moment: Central Park hike
2:14 PM
New York, New York
3 images, 1 video
```

Both experiences communicate historical placement.

Likewise, a sighted User may perform a historical jump through a spatial animation while another User activates an explicit "Jump to related Moment" action and receives a spoken announcement describing the destination.

The presentation differs.

The historical meaning and capability remain equivalent.

## No Single-Modality Dependency

Chronologity must not require any essential action or information to depend solely on:

- color;
- sound;
- animation;
- spatial position;
- hover;
- touch;
- drag;
- swipe;
- pinch;
- long press;
- visual icons;
- precise pointer movement;
- or another single modality.

Where one modality is convenient, an alternative must exist when the action or information is essential.

## Semantic Structure

Interactive surfaces must expose meaningful semantic structure.

A User should be able to determine:

- what screen or historical context they are in;
- what the primary content is;
- which controls are available;
- what each control does;
- which items are interactive;
- what state those items are in;
- what changed after an action;
- and how to move forward or backward.

Chronologity should not expose a complex Timeline as an undifferentiated collection of generic elements.

## Reading and Navigation Order

Assistive-technology reading order must reflect meaningful product order rather than incidental rendering order.

For chronological experiences, the reading order should preserve the relevant chronology unless the User intentionally changes navigation context.

For a Moment, reading order should make the relationship between:

- occurrence information;
- creator/author context;
- caption or description;
- media;
- historical context;
- Comments;
- Reactions;
- and actions

understandable.

Visual rearrangement must not create a nonsensical semantic order.

## Focus

Keyboard, switch, assistive-technology, and other focus-based interaction must have predictable focus behavior.

Focus should:

- move in a logical order;
- remain visible where a visual focus indicator is applicable;
- not become trapped unintentionally;
- not disappear after asynchronous updates;
- and move intentionally when navigation changes context.

When a modal, warning, report flow, media viewer, or other temporary surface closes, focus should return to an appropriate logical location.

## Focus and Historical Navigation

Temporal zoom and historical jumps can substantially change visible context.

After such navigation, Chronologity must establish focus at a meaningful destination and communicate what changed.

For example:

```text
Historical jump completed.
June 12, 1994.
Moment: Graduation ceremony.
```

The User should not be left at an arbitrary focus position in a newly rendered Timeline.

## Timeline Accessibility

Chronologity's Timeline is inherently spatial, but its semantics must not be spatial-only.

The accessible Timeline must communicate at least:

- current temporal position;
- direction of chronology;
- the current temporal scale;
- the identity and occurrence time of reachable Moments;
- relevant contextual relationships;
- the presence of historical gaps where appropriate;
- and available navigation actions.

A User should be able to navigate chronology without interpreting a 3D visual coordinate system.

## Vertical Chronology

Vertical chronology must have a nonvisual semantic equivalent.

Chronologity should expose occurrence time explicitly enough that a User does not need to determine which Moment is earlier or later based only on vertical placement.

Navigation actions may include concepts such as:

- previous Moment;
- next Moment;
- earlier;
- later;
- previous period;
- next period;
- or other temporally meaningful commands.

Exact labels depend on context.

## Horizontal Context

Horizontal positioning may visually represent contextual groupings or relationships.

Those relationships must also be expressible semantically.

A screen-reader or keyboard User should be able to understand why adjacent or related content is available, such as:

```text
Same Event
Same Location
Related Person
Causal relationship
Other contextual relationship
```

Horizontal distance or placement alone must not encode essential meaning.

## Depth Into a Moment

Chronologity's depth dimension represents moving into the details of a Moment.

This must also exist as an explicit navigational action.

A User who cannot perform or perceive a depth gesture must still be able to:

- open a Moment;
- inspect its media;
- read its context;
- interact with permitted social features;
- and return to the previous Timeline position.

Returning from Moment depth should restore navigation context rather than forcing the User to rediscover their prior location.

## Temporal Zoom

Temporal zoom is required from day one and must be fully accessible.

A User must be able to change temporal scale without relying on:

- pinch gestures;
- scroll-wheel precision;
- visual animation;
- or spatial intuition.

Chronologity should provide explicit accessible controls or actions for changing scale.

Conceptually:

```text
Zoom out in time
Zoom in in time
```

or equivalent controls may be necessary even if the primary visual interface uses gestures.

## Temporal Scale

When temporal zoom changes scale, the product must communicate the new scale in a form assistive technologies can perceive.

Examples might include:

```text
Showing one week
Showing three months
Showing 1990 through 1999
Showing century overview
```

The exact representation depends on Chronologity's final zoom model.

The User should never have to infer temporal scale solely from the visual density of the Timeline.

## Zoom-Derived Representations

At broader temporal scales, Chronologity may summarize, cluster, or otherwise abstract Moments.

Accessible representations must communicate:

- what the abstraction represents;
- the time period it covers;
- how many eligible Moments or historical entities it summarizes where appropriate;
- why a representative Moment or historical marker is being presented where useful;
- and how to inspect the underlying history.

The summary must not become an inaccessible visual shape with no semantic equivalent.

## Historical Significance and Accessibility

Historical significance may influence temporal zoom and historical-jump presentation.

When significance affects what is surfaced, accessibility must expose enough context for the User to understand the resulting historical representation.

The User does not necessarily need a numeric significance score.

But the product must not rely on visual prominence alone to communicate that a Moment is acting as an important historical anchor.

## Historical Jumps

Historical jumps are required from day one and must be operable without gesture or spatial navigation.

An accessible historical jump should communicate:

- the source context where useful;
- the relationship that enables the jump;
- the destination;
- the destination occurrence time;
- and the fact that Timeline context has changed.

Examples:

```text
Jump to earlier related Moment
Jump to Event
Jump to Location history
Jump to causal predecessor
Jump to causal consequence
```

The exact actions depend on the relationships available.

## Historical Jump Continuity

After a historical jump, Users must be able to understand where they arrived and return to the previous context.

The product should preserve navigation history independently of visual animation.

"Back" must mean something predictable.

Chronologity must not rely on remembering an animated trajectory through 3D space.

## Motion

Chronologity's Timeline may use animation to communicate movement through time, depth, zoom, and historical jumps.

Essential meaning must not depend on motion.

Users who prefer reduced motion must receive a usable alternative.

Reduced-motion behavior may:

- remove nonessential transitions;
- replace spatial travel with immediate state changes;
- shorten animations;
- replace zoom animation with discrete scale changes;
- avoid parallax;
- avoid unnecessary autoplay animation;
- and otherwise reduce vestibular or cognitive burden.

## Reduced Motion

Chronologity must respect applicable system-level reduced-motion preferences.

The product may also provide an explicit Chronologity setting if additional control is useful.

Reduced motion must not disable temporal zoom or historical jumps.

It changes how those capabilities are presented.

For example:

```text
Animated flight from 2026 to 1994
```

may become:

```text
Immediate transition
Announcement: June 1994
```

The historical capability remains intact.

## Flashing and Seizure Risk

Chronologity must avoid visual effects that create unacceptable flashing or seizure risk.

User-uploaded video may contain flashing content that Chronologity does not control at capture time.

The product should determine what detection, warnings, playback behavior, or moderation treatment is appropriate for such media.

Autoplay increases the importance of this issue.

## Media Accessibility

Images and videos are central to Chronologity.

Media accessibility must therefore be treated as core functionality rather than supplementary metadata.

Chronologity should support accessible descriptions for images and captions or equivalent access for meaningful video audio.

Media controls must themselves be accessible.

## Image Descriptions

Images should support meaningful alternative descriptions.

The product must distinguish where appropriate between:

```text
User-authored description
Machine-generated description
Decorative image
Image with no description available
```

A machine-generated description must not be silently represented as though the User wrote it.

## Historical Image Description

Image descriptions should focus on information useful to understanding the image in its Moment context.

Chronologity should avoid forcing creators to reproduce every visible detail.

For historically important images, descriptions may need to communicate:

- people;
- action;
- setting;
- meaningful objects;
- visible text;
- or other context

when relevant.

The exact authoring experience remains a product decision.

## Machine-Generated Accessibility Descriptions

Chronologity may use AI to assist with image accessibility.

If used, generated descriptions must be:

- distinguishable from User-authored descriptions where that distinction matters;
- correctable;
- privacy-aware;
- moderation-aware;
- and treated as derived metadata rather than historical truth.

AI must not invent certainty about Person identity, Location, Event membership, causality, or other historical facts.

## Video Captions

Videos containing speech or other meaningful audio should have captions or an equivalent accessible representation.

Captions should represent relevant spoken content and meaningful non-speech audio where appropriate.

If automatic captioning is used, generated captions should be correctable where practical.

The product must communicate when captions are unavailable rather than silently assuming audio is accessible to everyone.

## Video Transcripts

Transcripts may provide an additional accessible representation of video content.

A transcript is not necessarily identical to captions.

Chronologity may support transcripts later, but if transcripts become part of Search or historical context they must retain provenance and privacy semantics.

## Audio Descriptions

Some videos may require information about visual content that captions alone cannot convey.

Chronologity should evaluate whether User-authored or machine-assisted audio-description alternatives are needed, particularly for historically significant video.

This does not necessarily require a separate audio track on day one, but the product should not assume captions solve visual accessibility.

## Media Controls

Video controls must be accessible and operable without precise touch gestures.

Users must be able to identify and operate controls such as:

- play;
- pause;
- mute;
- unmute;
- seek where supported;
- captions;
- full-screen or expanded view where supported;
- and exit/return.

Control state must be communicated.

For example:

```text
Muted
Playing
Captions on
```

must not be indicated only by icon shape or color.

## Autoplay

Chronologity's established intended default is video autoplay with sound on where platform behavior permits it.

Accessibility requirements constrain how that default is implemented.

Users must be able to stop or pause media.

Chronologity must prevent multiple videos from producing overlapping audio.

Autoplay must not bypass sensitive-content warnings.

Reduced-motion, accessibility, platform, or explicit User preferences may alter autoplay behavior.

The product must provide sufficient control that autoplay does not make Chronologity unusable for Users with relevant accessibility needs.

## Sound

Information must not be conveyed only through sound.

If a sound communicates:

- a notification;
- successful action;
- error;
- navigation event;
- warning;
- or state change,

an equivalent visual and/or semantic indication must exist.

Likewise, meaningful video audio requires an accessible textual or equivalent alternative.

## Captions and Autoplay

Autoplayed video must make caption availability discoverable and operable.

If a User has an applicable system or Chronologity preference indicating captions should be enabled by default, the product should respect it where technically feasible.

Sound-on autoplay must not be treated as a substitute for captions.

## Large Moments

A Moment may contain an unlimited number of images and videos at the product-model level.

Accessibility must scale to large Moments.

A screen-reader or keyboard User must not be forced to traverse hundreds or thousands of media items simply to reach:

- Moment actions;
- historical context;
- Comments;
- navigation;
- or another major section.

Chronologity should provide meaningful structural navigation for large Moments.

Potential mechanisms include:

- headings;
- landmarks;
- sections;
- media counts;
- jump controls;
- grouped navigation;
- or other semantic structures.

These mechanisms must not create Sub-Moments or alter Moment identity.

## Media Ordering

Accessible media navigation must preserve the deterministic media order defined by the Moment.

The User should be able to understand position within the media collection.

For example:

```text
Image 14 of 83
Video 15 of 83
```

may be useful.

Exact numbering and announcement behavior should avoid excessive verbosity.

## Upload Accessibility

Creating a Moment with many media items must be accessible.

Users must be able to:

- select media;
- understand what was selected;
- determine upload status;
- identify failures;
- retry failed items;
- reorder media where supported;
- remove selected media;
- trim videos longer than 90 seconds;
- provide accessibility metadata;
- and understand when the Moment is ready to publish.

Upload progress must not be communicated only through animated bars.

## Drag-and-Drop Alternatives

If media reordering uses drag-and-drop, Chronologity must provide a non-drag alternative.

Possible actions include:

```text
Move earlier
Move later
Move to beginning
Move to end
```

or another efficient accessible mechanism.

For very large Moments, one-step movement alone may be impractical, so the product should support scalable reordering.

## Video Trimming Accessibility

The 90-second per-video limit must not require a visually precise timeline scrubber as the only trimming mechanism.

Users who cannot manipulate a graphical trimming control must still be able to select an eligible segment.

Accessible trimming may require:

- explicit start/end time fields;
- step controls;
- assistive-technology-accessible handles;
- or another equivalent interaction.

## Feed Accessibility

The Feed must expose chronological ordering semantically.

A User should be able to understand:

- which Moment they are on;
- occurrence context;
- creator context;
- media presence;
- available actions;
- and movement to earlier/later Feed entries.

Infinite or incremental loading must not create focus loss or an inaccessible endless sequence.

## Search Accessibility

Search must be operable through accessible text input and controls.

Results should expose:

- result type;
- relevant label/title;
- historical occurrence context where applicable;
- why the result may be relevant where useful;
- and available actions.

Search ranking must not be communicated only through visual prominence.

## Discovery Accessibility

Discovery may be visually rich, but every discoverable entity and navigation action must have a semantic representation.

Carousels, maps, grids, clusters, or other layouts must not become inaccessible containers.

Users should be able to understand what is being suggested and activate the same meaningful destinations.

## Location Accessibility

Location must not depend solely on a map.

If a map shows Moments, Events, or places, an accessible alternative must expose equivalent navigable information.

This may include:

- named Location;
- geographic hierarchy;
- distance where appropriate;
- related Moments;
- related Events;
- and historical time context.

A User who cannot perceive a map should still be able to explore Location-based history.

## Map Interaction

Where maps exist, essential actions must have non-map alternatives.

A User should not be required to:

- drag a map;
- pinch to zoom;
- visually identify a marker;
- or interpret marker clustering

to reach historical content.

Map zoom is geographic presentation.

It must remain distinct from Chronologity's temporal zoom semantics.

## Real-World Event Accessibility

Event pages and Event-based navigation must expose semantic structure independent of visual layouts.

Users should be able to understand:

- Event identity;
- date or time range;
- Location where permitted;
- associated Moments;
- relevant People where permitted;
- and navigation into Event history.

## Comments and Reactions

Comments and Reactions must be operable with assistive technologies.

The product should communicate:

- Comment authorship;
- Comment order;
- reply relationships if supported;
- edited state where applicable;
- Reaction state;
- Reaction counts;
- and whether the current User has reacted.

A Reaction must not be identifiable only through color or an unlabeled icon.

## Notifications

Notifications must be understandable without relying on iconography, color, sound, or visual grouping alone.

Each notification should communicate:

- what happened;
- relevant actor/context where permitted;
- the associated Moment or resource where applicable;
- and its read/unread state.

Read/unread state must not depend only on color.

## Forms

Forms must provide:

- meaningful labels;
- understandable instructions;
- clear required-field indication;
- accessible validation;
- logical focus order;
- and actionable error messages.

Placeholder text must not substitute for a persistent accessible label.

## Validation Errors

When validation fails, Chronologity should:

- identify that an error occurred;
- associate the error with the relevant field or control;
- explain how to correct it;
- and move or announce focus appropriately without disorienting the User.

An error must not be indicated only through red coloring.

## Errors and Async State

Asynchronous operations are common in Chronologity, especially media upload and processing.

Users must receive accessible feedback when:

- an operation begins where relevant;
- an operation succeeds;
- an operation fails;
- processing continues in the background;
- content becomes ready;
- or retry is required.

Status announcements should be useful without becoming excessively noisy.

## Loading

Loading states must be perceivable.

Skeleton screens alone are insufficient for Users who cannot perceive them.

Assistive technologies should receive meaningful loading/busy state where appropriate.

Loading completion should not unexpectedly reset focus.

## Empty States

Empty states should explain what is absent and what the User can do next.

For example:

```text
No Moments occurred during this period.
```

is more useful than an empty visual Timeline.

Privacy- or moderation-caused absence must not reveal information the User is not permitted to know.

## Color

Color may reinforce meaning but must not be the only way meaning is communicated.

This applies to:

- errors;
- success;
- selected state;
- read/unread state;
- privacy;
- moderation;
- significance;
- Timeline categories;
- relationship types;
- media status;
- and other product states.

## Contrast

Text, controls, focus indicators, icons, and meaningful visual boundaries must maintain sufficient contrast for the intended accessibility standard.

Chronologity's visual identity must adapt to accessibility requirements rather than treating low-contrast aesthetics as immutable branding.

## Text Scaling

The interface must tolerate larger text sizes without losing essential content or controls.

Text scaling must not:

- clip essential labels;
- hide actions;
- overlap controls;
- make forms unusable;
- or destroy navigation order.

Spatial Timeline presentation must adapt rather than disabling text scaling.

## Dynamic Type and Platform Text Preferences

On platforms that provide system text-size preferences, Chronologity should respect them within practical product constraints.

Where very large text fundamentally changes layout, the product should reflow into a more suitable representation rather than shrinking the text back to an inaccessible size.

## Orientation and Layout

Core mobile workflows should not depend unnecessarily on one device orientation unless a specific media experience genuinely requires it.

If a layout changes significantly with orientation or screen size, semantic order and focus behavior must remain coherent.

## Touch Targets

Interactive targets should be large enough to operate without high motor precision.

This applies especially to:

- media controls;
- Timeline controls;
- Reaction controls;
- Comment actions;
- privacy controls;
- report actions;
- close buttons;
- and small contextual menus.

Visually compact design must not create inaccessible hit targets.

## Gesture Alternatives

Every essential custom gesture must have an alternative.

This includes potential gestures for:

- temporal zoom;
- historical jumps;
- Timeline navigation;
- depth navigation;
- media reordering;
- media dismissal;
- image zoom;
- video seeking;
- and other interactions.

Standard platform gestures may still require semantic actions when the product's meaning would otherwise be unavailable.

## Timing

Chronologity should avoid unnecessary time-limited interactions.

If an action has a timeout, Users should receive appropriate control or extension where feasible.

Critical information must not disappear before a User with cognitive, visual, or motor accessibility needs can perceive and act on it.

## Cognitive Accessibility

Chronologity's historical model can be conceptually complex.

The product should reduce unnecessary cognitive burden through:

- consistent terminology;
- predictable navigation;
- explicit time context;
- clear state changes;
- understandable labels;
- progressive disclosure;
- stable interaction patterns;
- and avoidance of gratuitous animation or visual clutter.

Accessibility is not limited to screen readers.

## Temporal Orientation

Users must be able to determine where they are in time.

Chronologity should make current temporal context explicit, especially after:

- scrolling long distances;
- temporal zoom;
- historical jumps;
- Search entry;
- Discovery entry;
- Event navigation;
- Location navigation;
- or returning from Moment depth.

A visual date axis alone is insufficient.

## Spatial Orientation

Where Chronologity uses spatial presentation, Users must be able to determine context without remembering spatial coordinates.

Useful semantic orientation may include:

```text
Timeline: Richard
Viewing: June 1994
Scale: Month
Context: Graduation
```

The exact wording and available dimensions depend on the final product design.

## Consistency

The same conceptual action should use consistent names and semantics across the product.

If "Earlier" means moving backward in occurrence time in one Timeline context, it should not unexpectedly mean something different elsewhere.

Consistency is especially important for Users who learn interfaces through repeated semantic patterns rather than visual recognition.

## Plain Language

Accessibility-sensitive instructions, errors, privacy controls, moderation notices, and critical actions should use clear language.

Chronologity may contain sophisticated historical concepts, but the interface should not require Users to understand internal architecture or specialized terminology to perform ordinary actions.

## Accessibility and Privacy

Accessibility must not weaken privacy.

Accessible labels, descriptions, screen-reader text, hidden semantic content, transcripts, and alternative representations must obey the same authorization rules as visible content.

Chronologity must never hide sensitive information visually while leaving it exposed to assistive technologies.

Likewise, accessibility metadata must not expose precise Location, identity, or other private context beyond what the viewer may access.

## Accessibility and Moderation

Warnings, restricted-content states, reporting, moderation notices, and appeals must be accessible.

A sensitive-content warning must be announced before protected content is exposed.

Warning-gated media must not autoplay before the User chooses to reveal it.

Moderation status must not be communicated only through color or imagery.

## Accessibility and Historical Significance

Historical significance must not be represented solely by:

- size;
- brightness;
- color;
- spatial prominence;
- animation;
- or visual density.

If significance affects navigation or abstraction, the accessible experience must preserve the relevant meaning without implying that a machine-generated significance assessment is objective historical truth.

## Accessibility and Causality

Causal relationships must be expressible semantically.

Visual arrows or spatial connections are insufficient by themselves.

The accessible experience should distinguish relationship direction where known, such as:

```text
Caused by
Contributed to
Followed by
Related to
```

according to the causality model.

AI-suggested causal relationships must retain their hypothesis/provenance status in accessible representations.

## Accessibility and Privacy Controls

Privacy settings are high-consequence controls and must be understandable and operable without ambiguity.

The User must be able to determine:

- current visibility;
- who can access content;
- Location implications where relevant;
- effects of changing the setting;
- and whether derived surfaces such as Search or Discovery are affected.

The product must not rely on icons alone to communicate privacy.

## Accessibility and Destructive Actions

Destructive or high-consequence actions such as:

- deleting;
- removing media;
- blocking;
- reporting;
- changing sensitive privacy settings;
- or abandoning an upload

must have clear labels and appropriate confirmation where required.

Confirmation dialogs must themselves be accessible and must not trap focus.

## Accessibility and Authentication

Authentication flows must work with assistive technologies and accessible password managers.

Chronologity should avoid authentication mechanisms that unnecessarily depend on:

- visual puzzles;
- inaccessible CAPTCHAs;
- precise gestures;
- or memorization of transient information

without accessible alternatives.

Security and accessibility must be designed together.

## Accessibility and External Content

If Chronologity opens external web content or platform surfaces, the transition should be understandable.

Chronologity cannot guarantee the accessibility of third-party destinations, but it should avoid creating unnecessary inaccessible dependencies for core product functionality.

## Localization and Accessibility

Accessibility must account for future localization.

Semantic labels should not depend on English word length, English date formats, left-to-right layout, or English-only speech assumptions.

Date and time representations must remain understandable in the User's locale while preserving historical meaning.

## Accessibility Preferences

Chronologity may support explicit accessibility-related preferences beyond operating-system settings.

Potential preferences include:

- reduced motion;
- autoplay behavior;
- caption defaults;
- media sound behavior;
- higher-contrast presentation;
- or simplified Timeline motion.

Where a platform already provides an authoritative preference, Chronologity should generally respect it rather than forcing Users to configure the same need repeatedly.

## Accessibility Product Invariants

1.  Accessibility is a foundational product requirement from day one.
2.  Presentation is not meaning; essential historical semantics must survive alternative presentation.
3.  Equivalent access does not require identical visual presentation.
4.  Essential information or actions must not depend on a single sensory or interaction modality.
5.  Chronologity's spatial Timeline must expose nonvisual semantic structure.
6.  Reading and focus order must reflect meaningful product order rather than incidental rendering order.
7.  Focus must remain predictable through asynchronous updates and navigation.
8.  Temporal zoom and historical jumps must intentionally manage focus and announce context changes.
9.  Vertical position must not be the only representation of chronology.
10. Horizontal position must not be the only representation of historical context.
11. Depth gestures must have explicit alternatives for opening and leaving Moments.
12. Temporal zoom must be operable without pinch or other precision gestures.
13. Temporal scale must be communicated explicitly when zoom changes.
14. Zoom-derived clusters or summaries must have semantic equivalents.
15. Historical significance must not be communicated only through visual prominence.
16. Historical jumps must be operable without spatial gestures.
17. Historical-jump destinations and relationships must be understandable to assistive technologies.
18. Reduced motion must preserve product capability while changing presentation.
19. Reduced-motion preferences must not disable temporal zoom or historical jumps.
20. Essential meaning must not depend on animation.
21. Chronologity must avoid unacceptable flashing and seizure risks.
22. Images must support meaningful accessible descriptions.
23. Machine-generated image descriptions must not masquerade as User-authored historical truth.
24. Meaningful video audio requires captions or an equivalent accessible representation.
25. Captions must not be treated as a complete substitute for visual accessibility.
26. Media controls must be semantically labeled, operable, and expose state.
27. Autoplay must remain stoppable and controllable.
28. Multiple videos must not produce overlapping autoplay audio.
29. Sensitive warning-gated media must not autoplay before reveal.
30. Information conveyed by sound must have a non-auditory equivalent.
31. Unlimited-media Moments must remain navigable without forcing traversal of every media item to reach other major sections.
32. Accessible media navigation must preserve deterministic media order.
33. Upload progress, processing, failure, and retry states must be accessible.
34. Drag-and-drop must not be the only way to reorder media.
35. The 90-second video-trimming workflow must not depend solely on precise visual manipulation.
36. Feed chronology must be semantically perceivable.
37. Search and Discovery must expose result meaning independently of visual layout.
38. Location-based history must have an accessible alternative to map-only interaction.
39. Real-world Event navigation must expose semantic historical structure.
40. Comments and Reactions must expose authorship, state, and relationships accessibly.
41. Notification meaning and read state must not depend on color, sound, or iconography alone.
42. Forms require persistent accessible labels and actionable validation.
43. Errors and asynchronous state changes must be perceivable without creating excessive announcement noise.
44. Loading and empty states must have semantic representations.
45. Color must never be the sole carrier of essential meaning.
46. Text and interactive elements must meet the adopted contrast requirements.
47. Core workflows must tolerate accessible text scaling and reflow.
48. Chronologity should respect applicable platform text-size preferences.
49. Interactive targets must not require unnecessarily high motor precision.
50. Essential custom gestures require accessible alternatives.
51. Critical interactions should avoid unnecessary time limits.
52. Chronologity should reduce unnecessary cognitive complexity through consistent terminology and predictable navigation.
53. Users must be able to determine their temporal context without relying on a visual axis.
54. Users must be able to determine spatial/historical context without memorizing visual coordinates.
55. Accessibility semantics must obey the same privacy and authorization rules as visible content.
56. Accessibility metadata must not leak hidden sensitive information.
57. Moderation warnings, reports, enforcement notices, and appeals must be accessible.
58. Causal relationships and their direction/provenance must have semantic representations.
59. Privacy controls must communicate their current state and consequences accessibly.
60. Destructive and high-consequence actions must be clearly labeled and accessible.
61. Authentication must not unnecessarily depend on inaccessible challenges.
62. Core Chronologity functionality must not depend on inaccessible third-party experiences.
63. Accessibility implementation must anticipate localization and varied date/time conventions.
64. System-level accessibility preferences should be respected where applicable.
65. Accessibility requirements must be preserved across mobile and web surfaces even when interaction patterns differ.

## Day-One Requirements

Before launch, Chronologity must explicitly define and support:

- the accessibility standard or conformance target Chronologity intends to meet;
- screen-reader semantics for all launch-critical mobile workflows;
- accessible web semantics for launch-critical web workflows;
- logical reading order;
- logical focus order;
- visible focus treatment where applicable;
- focus restoration;
- focus behavior after navigation;
- Timeline semantic structure;
- explicit occurrence-time communication;
- accessible earlier/later navigation;
- accessible horizontal/context relationship navigation;
- accessible entry into and return from Moment depth;
- non-gesture temporal zoom controls;
- temporal-scale announcements;
- accessible zoom-derived summaries;
- non-gesture historical-jump controls;
- historical-jump destination announcements;
- navigation continuity after historical jumps;
- reduced-motion behavior;
- applicable system reduced-motion preference support;
- safe animation/flashing requirements;
- image-description behavior;
- image-description authoring behavior;
- machine-generated description policy if used;
- video caption requirements;
- caption display and controls;
- media-control labels and states;
- autoplay accessibility behavior;
- sound controls;
- prevention of overlapping audio;
- accessible handling of sensitive-media warnings;
- large-Moment structural navigation;
- media position semantics where useful;
- accessible media selection;
- accessible upload progress;
- accessible processing states;
- accessible retry behavior;
- accessible media reordering;
- non-drag reorder controls;
- accessible video trimming;
- Feed semantics;
- Search semantics;
- Discovery semantics;
- non-map Location navigation;
- Event navigation;
- Comment semantics;
- Reaction semantics;
- notification semantics;
- form labels;
- validation behavior;
- async status announcements;
- loading states;
- empty states;
- color-independent state communication;
- contrast requirements;
- text scaling;
- touch-target requirements;
- gesture alternatives;
- privacy-control accessibility;
- reporting accessibility;
- moderation-warning accessibility;
- appeal accessibility;
- destructive-action confirmation;
- authentication accessibility;
- accessibility testing expectations;
- assistive-technology testing coverage;
- and ownership for accessibility defects before release.

Accessibility defects that make a launch-critical workflow materially unusable should be treated as release-blocking defects, not cosmetic backlog items.

## Open Product Questions

The following questions require deliberate resolution:

- Which formal accessibility target will Chronologity adopt for launch?
- Should WCAG 2.2 AA be the baseline for applicable web and product semantics?

**Answered in 12A: WCAG 2.2 AA** (ADR-156). 4.5:1 for body text, 3:1 for
user-interface components and meaningful boundaries. Until something was adopted,
invariant 46 — "must meet the adopted contrast requirements" — could not be
checked or failed, which is how a 2.8:1 grey came to be the colour of the row
saying a Moment is not yours to read. `apps/mobile` now computes every role pair
against every surface in both appearances and fails the build below the floor.

- How should native mobile platform guidance supplement a web-oriented conformance target?
- Which assistive technologies must be included in the supported launch matrix?
- Which combinations of iOS VoiceOver, Android TalkBack, keyboard, switch control, browser screen readers, and other technologies must be manually tested?
- What level of accessibility support is required for the Gatsby marketing site at launch?
- What level is required for the mobile app?
- What accessibility requirements apply to the Feed Aggregator's GraphQL boundary indirectly through clients?
- Who owns accessibility acceptance for each feature?
- What constitutes a release-blocking accessibility defect?
- How should accessibility bugs be prioritized relative to other functional bugs?
- Should every product specification include an accessibility subsection, or should this document plus feature-specific requirements be sufficient?
- How will accessibility requirements be represented in design reviews?
- How will they be represented in engineering acceptance criteria?
- What semantic model best represents the 3D Timeline to a screen reader?
- Should the accessible Timeline behave primarily as a chronological list with contextual actions?
- Should it expose a tree, grid, collection, or another semantic structure?
- How do we preserve horizontal contextual relationships without making navigation excessively verbose?
- How should a User discover that additional horizontal context exists?
- Should context relationships be exposed as actions on each Moment, a separate context region, or both?
- How should Timeline depth be announced?
- Should entering a Moment be described as "Open Moment," "View Moment details," or another consistent action?
- What is the exact accessible "back to Timeline" behavior?
- Must return restore the exact previously focused Moment?
- The recommended answer is yes where the resource still exists and remains accessible.
- What happens if the previous Timeline position has changed because privacy or moderation removed content?
- How should temporal zoom controls be labeled?
- Should controls use "Zoom in/out" terminology, "Narrow/widen time range," named scales, or a combination?
- "Zoom" may be visually intuitive but ambiguous to Users who do not experience the spatial representation.
- Should the product expose discrete temporal scales?
- If scales are continuous visually, should accessible controls still use meaningful discrete steps?
- How should a screen reader announce a zoom transition?
- How much context is useful before announcements become disruptive?
- Should temporal scale be persistently available as a heading/status region?
- How are dense periods represented accessibly?
- How are sparse periods represented?
- How are periods containing no accessible Moments represented?
- How should zoom clusters be named?
- Should a cluster announce Moment count?
- Could counts leak private or moderated history?
- Counts must only reflect information the viewer is authorized to know.
- Should clusters expose the most historically significant accessible Moment?
- How should the product communicate why that Moment is representative without overclaiming objective importance?
- How are historical significance cues represented to screen readers?
- Should significance be described at all, or should only the navigation outcome be exposed?
- Does a User need an option to inspect why a Moment was surfaced at a broad temporal scale?
- How should historical jumps be discovered without relying on visual relationship lines?
- Should each Moment expose a "Related history" region?
- How are different relationship types ordered?
- How is causal direction announced?
- How are AI-suggested relationships distinguished from User-asserted or system-derived relationships?
- What does "Back" mean after multiple historical jumps?
- Should Chronologity maintain an explicit historical-navigation stack?
- How should that stack interact with ordinary application navigation?
- Should Users be able to review their jump history?
- How does reduced motion affect historical-jump transitions?
- Should reduced motion always make jumps instantaneous?
- Could an instantaneous jump itself be cognitively disorienting?
- Would a brief fade plus explicit temporal announcement be better?
- What maximum transition duration is appropriate?

**Answered in 12A: 200 milliseconds**, as a ceiling rather than a default
(ADR-156). Long enough to read as movement, short enough that somebody moving
quickly never waits for the interface to agree. Under reduced motion every
duration is zero, which changes how a capability is presented without removing
it.

- Which animations are essential to comprehension versus decorative?
- Should Users be able to disable all nonessential animation independently of the system preference?
- Should a Chronologity-specific reduced-motion preference sync across devices?
- How should autoplay behave when reduced motion is enabled?
- Should reduced motion disable video autoplay by default?
- Motion in user video is different from UI motion; should those preferences remain separate?
- Should Chronologity provide separate `Reduce interface motion` and `Disable video autoplay` preferences?
- How should system autoplay/media accessibility preferences influence Chronologity?
- How should seizure-risk content be detected or handled?
- Should videos with likely flashing content be prevented from autoplaying?
- Should they receive a warning?
- Is automated flashing detection reliable enough for product enforcement?
- Which image formats require special accessibility handling?
- Should every image require alt text before publication?
- Would mandatory alt text create an unreasonable barrier for large Moments containing hundreds of images?
- How can Chronologity make large-scale image accessibility practical without discouraging historical uploads?
- Should alt text be optional but strongly encouraged?
- Should AI-generated descriptions fill gaps?
- If AI descriptions are generated, should they be available immediately or only on request?
- Who may edit an AI-generated description?
- Does creator correction replace the generated description or coexist with provenance?
- Can viewers propose corrections to inaccurate accessibility descriptions?
- Is that an accessibility correction, historical correction, or ordinary contribution?
- Should accessibility descriptions be visible to sighted Users?
- Could making them visible improve correction and transparency?
- How should descriptions handle sensitive personal attributes that a vision model might infer?
- AI descriptions should not infer sensitive traits unnecessarily.
- How should descriptions handle uncertain Person identity?
- How should descriptions handle Location?
- Should AI ever name a Person based on face recognition? The recommended answer is no under the current product direction.
- Should OCR-derived text be included in image descriptions?
- What if visible text contains private information?
- How should image descriptions interact with moderation?
- If an image is removed, all derived accessibility metadata must become unavailable as required.
- If an image is warning-gated, should its alt text also be gated? The recommended answer is yes when the description itself would reveal the sensitive content.
- Should decorative media exist inside a Moment?
- Since Moment media is historical content rather than UI decoration, probably very little Moment media should be semantically "decorative."
- How are UI decorative images distinguished from historical media?
- Are captions mandatory for every video with speech before publication?
- Would mandatory pre-publication caption processing conflict with rapid uploads or large Moments?
- Can videos publish while captions are processing?
- If so, what experience does a deaf User receive during that interval?
- Should speech-containing video remain unavailable until captions are ready?
- Could creator-provided captions satisfy publication readiness?
- How accurate must automatic captions be?
- What correction workflow exists?
- Can captions be edited after Moment publication without violating historical-integrity rules?
- Caption correction should likely be treated as accessibility metadata correction rather than alteration of the original media.
- How is caption provenance stored?
- How are multilingual videos captioned?
- Can a video have multiple caption tracks?
- Should language be detected automatically?
- How are code-switching and mixed-language videos handled?
- How are non-speech sounds represented?
- Should music lyrics be captioned, considering rights and product constraints?
- How are captions presented when the source audio is unintelligible?
- Should transcripts be day-one functionality?
- If not, are captions sufficient for launch?
- When would audio description become required?
- Can User-authored text descriptions serve as a launch alternative to full audio-description tracks?
- How should a blind User understand important visual action in a video that contains no speech?
- Could AI-generated video descriptions help?
- What accuracy and privacy safeguards would be required?
- Should video poster frames have their own descriptions?
- How should video controls behave with VoiceOver and TalkBack?
- What seek increments should be available?
- Does every 90-second video need seek controls?
- How should current playback time and total duration be announced?
- Should playback speed controls exist for accessibility?
- Should captions default on when the operating system indicates a preference?
- Should mute state persist?
- Should autoplay preference persist per account or per device?
- Should sound-on autoplay be disabled when a screen reader is active?
- There may be usability benefits, but assistive-technology detection should not be used as a crude proxy for User preference.
- Should Chronologity instead provide clear explicit media preferences?
- How do we prevent autoplay announcements from overwhelming screen-reader speech?
- Should offscreen autoplay stop immediately?
- How should focus interact with playing video?
- Does focusing a video start it?
- The recommended default is no; focus should not unexpectedly trigger media.
- Does entering full-screen media move focus predictably?
- How is exit announced?
- How should large Moments be structured semantically?
- Should media be grouped into navigable sections?
- If sections are User-defined, how do they avoid becoming Sub-Moments?
- Should a screen-reader User be able to skip all media?
- Should there be a "Skip media" or "Jump to Comments" action?
- Should the interface expose media counts before traversal?
- At what size does a large Moment require additional navigation controls?
- Since media count is unlimited, the architecture must not assume a small fixed traversal.
- How should virtualized lists preserve screen-reader position?
- How should incremental loading be announced?
- How do we prevent newly loaded media from unexpectedly shifting focus?
- How are internal pagination boundaries hidden from product semantics while remaining usable?
- How should media reorder work for hundreds or thousands of items without drag-and-drop?
- Should Users be able to move an item directly to a numbered position?
- Should accessible reorder controls expose "Move before..." search?
- How should selection order be announced during multi-file upload?
- How does the User know which media failed?
- How are retry controls associated with the correct item?
- How is overall upload progress announced without excessive updates?
- What announcement cadence is appropriate for long uploads?
- How is video-processing status announced?
- How does a User safely leave an upload screen?
- How is background-upload continuation communicated?
- How should the 90-second trimming interface work with screen readers?
- Should start and end times be editable numeric controls?
- How should preview playback integrate with trimming?
- How should errors such as `clip exceeds 90 seconds` be communicated?
- Can Users create multiple accessible clips from one source video?
- How does a keyboard-only User navigate the web experience?
- Does the marketing site need a skip link?
- Which application regions need landmarks?
- How are modal dialogs implemented semantically?
- How are popovers and context menus navigated?
- How should infinite Feed loading work for keyboard and screen-reader Users?
- Should the Feed provide explicit load-more controls even if sighted Users receive automatic loading?
- How does a User know their position in the Feed?
- Should occurrence time be announced before or after creator information?
- How verbose should each Feed item be by default?
- Can Users choose more concise screen-reader announcements?
- Should a Timeline provide direct date navigation as an accessibility feature?
- Direct date navigation may benefit all Users and align strongly with historical jumps.
- Should Users be able to type or choose a date and jump directly to it?
- If so, is this a general Timeline capability rather than an accessibility-only feature?
- What happens when no Moment exists on the requested date?
- How should Search results expose result types?
- How should historical dates be read, especially BCE/CE or uncertain dates if Chronologity eventually supports them?
- How should approximate dates be announced?
- How should date ranges be announced?
- How should historical time zones be represented?
- How should Search highlighting be exposed semantically?
- Should result snippets be read automatically?
- How should Discovery carousels be represented?
- Should carousels have explicit previous/next controls?
- How should a screen-reader User know how many items exist?
- How should visual grids linearize?
- How should Discovery explain why an item is suggested, if at all?
- How are maps represented accessibly?
- Should every map have a synchronized list representation?
- Can Users choose list-first Location navigation?
- How are map clusters represented?
- How are geographic zoom and temporal zoom distinguished in labels?
- How are distances communicated?
- Which units follow locale preferences?
- How is Location precision communicated without leaking private information?
- How are historical place names represented alongside current names?
- How should Event timelines be navigated?
- How should Comments with replies be represented?
- If nested replies exist, how much nesting is tolerable for assistive technologies?
- Should Chronologity avoid deeply nested Comment threads for accessibility and product simplicity?
- How are edited Comments announced?
- How are removed Comments represented?
- How are Reaction pickers labeled?
- How is current Reaction state announced?
- Should Reaction counts be included in default screen-reader announcements or available on demand to reduce noise?
- How are unread notifications announced?
- Should the application announce new notifications in real time?
- Could that interrupt historical navigation excessively?
- Should notification announcements be limited to urgent categories?
- How should read/unread state be exposed?
- How should privacy visibility states be named?
- How do we ensure terms such as `Private`, `Followers`, or future audience labels are unambiguous?
- Should privacy changes announce their effect on Search and Discovery?
- How should Location privacy controls explain precision?
- How should blocking flows be navigated?
- How should a User understand the consequences of blocking before confirmation?
- How should report reason selection work?
- How should sensitive report categories be worded?
- How should moderation notices avoid overly complex legalistic language?
- How should warning-gated content be represented to screen readers before reveal?
- The warning should describe the category without exposing the protected content itself.
- How should appeals support attaching or entering contextual evidence accessibly?
- How should status changes in an appeal be announced?
- How should color palettes meet contrast requirements in both light and dark appearance?
- Should Chronologity provide a dedicated high-contrast mode?
- Or should standard themes already meet the required contrast?

**Answered in 12A: both appearances ship, and each holds the floor on its own**
(ADR-156). Not a light palette with a dark variant derived from it — two palettes,
each measured. No dedicated high-contrast mode: the standard themes already meet
the requirement, which is the second of the two options above and the one that
does not create a surface people have to find.

- How should historical-significance visualizations remain accessible under high contrast?
- How should causality lines or connectors be represented without relying on color?
- How should selected Timeline scale be represented without color?
- What minimum touch-target size will Chronologity adopt?

**Answered in 12A: 44 points** (ADR-156). The lower of the two platform floors,
so one number satisfies both. Reached with `hitSlop` rather than a minimum
height, so a compact design stays compact and stays operable — which is what
"Visually compact design must not create inaccessible hit targets" asks for.

- How should adjacent small Reaction controls avoid accidental activation?
- Which gestures require explicit buttons even for sighted Users?
- Could providing visible zoom/jump controls improve discoverability for everyone?
- How should switch-control navigation traverse the Timeline?
- How should voice-control Users activate controls with unique accessible names?
- Do repeated controls such as "More" need contextual labels?
- How should text scaling affect the 3D Timeline?
- At very large text sizes, should Chronologity switch to a more linear Timeline layout?
- If so, should that be considered the same product experience semantically? The recommended answer is yes.
- How should media overlays reflow under large text?
- How should long historical captions behave?
- Should Users be able to increase line spacing or use platform-level settings?
- How should orientation changes preserve Timeline position and focus?
- Must every mobile workflow support landscape?
- Are there legitimate exceptions for particular media-capture experiences?
- How should cognitive accessibility influence Timeline terminology?
- Are "temporal zoom" and "historical jump" internal/product concepts or literal UI labels?
- Should UI language use simpler terms while documentation retains canonical terminology?
- How should the product explain occurrence time versus upload time without confusing Users?
- How should uncertainty be communicated?
- How should historical corrections be presented clearly?
- Should there be a simplified navigation mode?
- Would a simplified mode become a second-class product or provide useful universal design?
- Could a linear Timeline mode benefit accessibility, low-end devices, and Users who simply prefer it?
- If provided, must it expose all day-one capabilities including temporal zoom and historical jumps?
- The recommended answer is yes.
- How should keyboard shortcuts work on web?
- Should shortcuts exist for earlier/later Moment, zoom in/out, open Moment, and back?
- How are shortcuts discoverable?
- How do we avoid conflicts with assistive technologies and browsers?
- Should Users be able to disable custom shortcuts?
- How should timeout behavior work for authentication or sensitive actions?
- Can session-expiration warnings be extended?
- How are temporary notifications/toasts announced?
- How long do visual toasts remain?
- Should important messages persist in a notification region rather than disappear?
- How should errors be summarized on long forms?
- Should focus move to the first invalid field or an error summary?
- How should success messages be announced?
- How do we avoid announcement fatigue?
- What automated accessibility tests are required in CI?
- Which accessibility requirements cannot be validated automatically?
- What manual test cadence is required?
- Should every major release include VoiceOver and TalkBack regression passes?
- Should Chronologity include Users with disabilities in usability research?
- How early in product development should that begin?
- How are accessibility findings incorporated into roadmap prioritization?
- Should Chronologity publish an accessibility statement?
- Should the product provide a dedicated accessibility feedback mechanism?
- How should Users report accessibility barriers?
- Should accessibility reports have a distinct support category?
- What response expectations should apply?
- How does Chronologity test accessibility at extreme historical scale?
- Can a screen-reader User navigate a Timeline containing millions of Moments without conceptual or performance failure?
- How does virtualization preserve semantic continuity?
- How do temporal zoom and historical significance reduce traversal without hiding accessible history?
- How do privacy and moderation filters affect accessible counts and summaries?
- How should Chronologity ensure future features cannot ship with inaccessible gesture-only behavior?
- Should design-system components enforce accessible defaults?

**Answered in 12A: yes, and with no way to opt out** (ADR-156). The text
primitive has no way to cap font scaling, the pressable has no way to fall below
the touch floor, the input cannot be built without a visible label, and text
takes a colour role rather than a value — so every colour that can reach the
screen is one the contrast test has measured. An override "for the cases that
need it" was considered and rejected: those are the cases where somebody is in a
hurry, and a rule that yields under pressure documents an intention rather than
enforcing one.

- Which product invariants should be encoded in shared UI primitives?
- How do we prevent mobile and web accessibility behavior from diverging semantically?
- How should accessibility requirements be documented when a feature intentionally behaves differently by platform?
- What accessibility telemetry, if any, is appropriate?
- Chronologity should be cautious about inferring or recording disability-related information.
- Product analytics should not require identifying Users as disabled.
- How can accessibility quality be measured without collecting sensitive User attributes?
- What performance thresholds are necessary for assistive technologies?
- Could extremely heavy Timeline rendering make screen-reader navigation technically correct but practically unusable?
- Accessibility performance must be treated as usability, not merely semantic correctness.
- How should offline/intermittent connectivity states be announced?
- How should failed media loading be represented?
- How should unavailable historical content be represented without leaking privacy or moderation details?
- How should localization affect screen-reader pronunciation of names, Locations, dates, and historical terminology?
- How should right-to-left layouts affect horizontal contextual navigation?
- Does horizontal position retain the same semantic direction under RTL layouts, or should visual layout adapt while relationship semantics remain explicit?
- How should calendars other than Gregorian be handled if supported later?
- How should accessibility requirements evolve when Chronologity adds new media types, AR/VR, spatial interfaces, or other future experiences?

These questions should be resolved before interface architecture hardens assumptions that essential Chronologity capabilities require vision, hearing, motion, spatial perception, precise touch, or gesture.

## Architecture Constraints

This document does not prescribe React Native accessibility props, DOM structure, ARIA implementation, native accessibility APIs, component libraries, testing frameworks, or platform-specific code.

It does impose architectural constraints.

Chronologity's clients must be able to obtain semantic information independently from visual coordinates.

The product cannot require clients to infer essential meaning from:

```text
x/y/z position
pixel size
color
animation
gesture
media waveform
map marker position
```

alone.

Timeline and historical-navigation APIs/read models must expose sufficient semantic context for accessible clients to represent:

- occurrence time;
- temporal scale;
- chronological direction;
- contextual relationships;
- historical-jump relationships;
- historical significance where presentation depends on it;
- Event and Location context where authorized;
- and navigation continuity.

Temporal zoom must be invokable as a semantic operation, not only as a graphical transform.

Historical jumps must be invokable as semantic navigation, not only as animated spatial transitions.

Client state must support focus restoration and return to prior Timeline context after entering Moment depth or following historical jumps.

Virtualized and incrementally loaded collections must preserve stable identity so assistive technologies can maintain meaningful position.

Media APIs and models must support accessibility metadata without conflating it with the original media binary or authoritative historical facts.

Conceptually:

```text
Media
  |
  +-- original/derived asset data
  +-- User-authored accessibility metadata
  +-- machine-generated accessibility metadata + provenance
  +-- caption tracks + provenance
  +-- processing state
```

Privacy and authorization must apply equally to visual data and accessibility metadata.

A hidden or restricted resource cannot remain discoverable through:

- alt text;
- captions;
- transcripts;
- semantic labels;
- accessibility trees;
- Search indexes derived from accessibility metadata;
- or cached accessible descriptions.

The architecture must support system/User preferences such as reduced motion, autoplay, and caption defaults without making those preferences redefine historical semantics.

Large Moments must be retrievable and navigable incrementally without requiring assistive technologies to materialize an unlimited media collection at once.

Async operations must expose machine-readable state sufficient for clients to communicate:

- uploading;
- processing;
- ready;
- failed;
- retrying;
- and other relevant states

without scraping visual presentation.

Accessible labels for repeated controls must be contextualizable with stable entity identity.

The architecture should favor shared semantic contracts and reusable accessible UI primitives so mobile and web do not independently invent incompatible meanings for Timeline navigation, zoom, jumps, privacy, moderation, or media state.

Finally, accessibility must be testable.

Architecture and component boundaries should make it possible to verify semantic state, focus behavior, keyboard/assistive-technology operation, reduced-motion behavior, captions, and alternative navigation without relying exclusively on manual visual inspection.

## Guiding Principle

When making an interaction or presentation decision, ask:

> **If a User cannot see this layout, hear this audio, perceive this motion, or perform this gesture, can they still understand where they are in history and accomplish the same meaningful task?**

If the answer is no, the product semantics are incomplete.

Chronologity should make history navigable through meaning, not merely through pixels.
