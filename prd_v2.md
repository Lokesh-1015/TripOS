# TripOS --- Product Requirements Document (PRD)

**Version:** 0.2\
**Suggested filename:** `prd_v2.md`\
**Phase:** Traveller Social Network & Public Trip Discovery\
**Status:** Proposed\
**Previous document:** TripOS PRD v0.1

------------------------------------------------------------------------

# 1. Introduction

## 1.1 Purpose

This document defines the next major phase of TripOS. The previous phase
established TripOS as a collaborative travel workspace where users can
create trips, invite people, coordinate itineraries, manage expenses,
communicate, organize documents, and preserve memories.

This phase evolves TripOS into a **travel social platform built around
human connection and shared journeys**. Users should not only open
TripOS when they already have a group and a trip to organize. They
should also discover people who love travelling, find potential travel
companions, build friendships, discover trips hosted by others, and
create meaningful travel experiences together.

This document assumes that the important foundations described in PRD
v0.1 are already implemented or substantially complete. It focuses on
new product capabilities and intended user experience, not technical
implementation.

## 1.2 Product evolution

**Previous vision:** A collaborative workspace for organizing group
trips.

**Evolving vision:** A social home for travellers where people discover
journeys, connect with fellow travellers, build friendships, host and
join trips, share experiences, and preserve memories.

TripOS should combine collaborative trip planning, traveller discovery,
public trip discovery, travel-focused social sharing, and personal and
collaborative travel memories.

TripOS must not become a generic social media platform. Its identity
must remain rooted in travel, real-world experiences, friendship, and
shared journeys.

------------------------------------------------------------------------

# 2. Product philosophy

## 2.1 The emotional centre of TripOS

TripOS should help people find people they would genuinely enjoy
travelling with.

The social experience should carry warmth, trust, excitement, belonging,
and the emotion of discovering a shared adventure. It should encourage
meaningful connections rather than superficial engagement.

The product should help users answer: - Who else loves the kind of
travel I love? - Is there someone planning a trip I would love to
join? - Can I find people who might become friends and travel
companions? - What journeys are people in my travel community
planning? - How can I turn an online connection into a real shared
experience?

The goal is not to maximize likes, followers, or endless scrolling. The
goal is to help people connect and experience travel together.

## 2.2 Three pillars

**DISCOVER** --- Find travellers, public trips, destinations, and
opportunities to travel.

**CONNECT** --- Build friendships, find compatible travel companions,
and develop a trusted travel community.

**EXPERIENCE** --- Host trips, join journeys, plan together, share
experiences, and preserve memories.

------------------------------------------------------------------------

# 3. Product goals

1.  Transform TripOS into a social hub for travellers.
2.  Help users discover and connect with people who share travel
    interests.
3.  Support meaningful, mutual friendships between travellers.
4.  Enable users to host public and private trips.
5.  Make public trips discoverable through a redesigned Explore
    experience.
6.  Allow interested travellers to request to join public trips, with
    the host retaining control over acceptance.
7.  Give hosts control over trip capacity.
8.  Encourage travel-focused photo sharing and storytelling.
9.  Keep trip memories distinct from general social posts.
10. Increase the usefulness of TripOS even when users do not currently
    have a trip planned.
11. Build a safe, privacy-conscious community.
12. Encourage real-world travel experiences rather than engagement for
    its own sake.

------------------------------------------------------------------------

# 4. User profiles and privacy

## 4.1 Traveller profile

Every user should have a profile representing their travel identity. A
profile may include: - Profile photograph. - Cover photograph
(optional). - Display name and unique username. - Short biography. -
Location (optional). - Travel interests and preferred travel styles. -
Favourite destinations and places visited. - Public upcoming trips
hosted by the user. - Completed trips the user chooses to display. -
Travel posts. - Friends or connections.

The profile should help another traveller understand the person's
interests and travel personality.

## 4.2 Public and private profiles

Users should choose between public and private profile visibility.

**Public profile:** Other users can view information the profile owner
has chosen to make public, including public posts, public hosted trips,
selected travel interests, and experiences. Visitors may send a friend
request.

**Private profile:** Non-friends see only limited profile information,
such as display name, username, and profile photograph, according to the
user's privacy choices. They cannot access private posts or restricted
travel information. A private profile may still receive friend requests
unless the user has restricted them.

## 4.3 Profile privacy controls

Users should be able to: - Switch between public and private profiles. -
Choose visibility for individual posts. - Control whether hosted trips
are publicly visible. - Manage who can send friend requests. - View and
manage friends. - Remove friends. - Block users. - Report inappropriate
profiles.

Profile visibility, post visibility, and trip visibility are separate
controls. Making a profile public must never automatically make every
post, trip, memory, or document public.

------------------------------------------------------------------------

# 5. Friend requests and meaningful travel connections

Friendship is central to the TripOS social experience. The goal is to
help travellers build genuine connections with people they may want to
travel with, not simply accumulate followers.

## 5.1 Sending friend requests

Users can send friend requests from: - Another user's profile. - A
public trip's host or participant list, where permitted. - Travel
posts. - Traveller discovery experiences.

## 5.2 Friend request management

Provide a dedicated place to manage incoming requests, sent requests,
accepted requests, and declined requests.

Actions include: - Accept. - Decline. - Cancel sent request. - Remove
friend. - Block user.

After acceptance, both users appear in each other's friends lists.
Relationship states should be clear: **Add Friend**, **Request Sent**,
**Accept Request**, and **Friends**.

Repeated requests must not be possible while an earlier request is
pending.

## 5.3 Friends list

Users can view and search friends, open profiles, see permitted public
travel interests and trips, remove friends, and block users.

Being friends must not automatically grant access to private trips,
private posts, or private documents.

## 5.4 Emotional and trust-centred experience

The friendship experience should feel personal and welcoming.

Avoid making follower counts, popularity rankings, or engagement metrics
the primary measure of a traveller's value.

Prioritize shared travel interests, common destinations, similar travel
styles, mutual friends where appropriate, public trips and experiences,
and clear privacy and trust indicators.

The product should feel like meeting fellow travellers, not browsing a
generic social network.

------------------------------------------------------------------------

# 6. Public and private trips

When creating a trip, the host chooses whether it is public or private.
This setting is also available when editing an existing trip.

## 6.1 Public trips

A public trip can be discovered through Explore.

Its public detail page may show: - Trip title and destination. - Cover
photograph. - Travel dates or date flexibility. - Trip description. -
Proposed itinerary or travel plan. - Estimated budget, if the host
chooses to display it. - Host profile. - Participant count. - Maximum
participant count, if enabled. - Trip category and travel style. -
Available places.

The page should provide enough information to help visitors decide
whether the journey interests them without exposing private participant
information or sensitive trip details.

### Request to join

An interested user can request to join a public trip. The request goes
to the trip host.

The host can view requests, review the requesting user's permitted
public profile information, accept or reject requests, review pending
requests, and view accepted participants.

A public trip does not mean anyone can automatically become a
participant. Public visibility provides discoverability; participation
requires host approval.

## 6.2 Private trips

A private trip must not appear in public Explore results.

The host controls who can join through: 1. Direct invitations. 2. A
private invitation link, subject to the trip's access rules.

The invitation experience should clearly explain the joining process.
Private trip information remains inaccessible to unrelated users.

## 6.3 Changing trip visibility

The host can change a trip from public to private or private to public.

Before applying the change, explain its implications: - Making a private
trip public allows it to appear in Explore. - Making a public trip
private removes it from public discovery. - Existing participants remain
unless the host explicitly removes them.

Changing visibility must not silently expose information the host
intended to keep private.

------------------------------------------------------------------------

# 7. Maximum participant limit

Introduce an optional participant limit so hosts can control trip size.

## 7.1 Enable participant limit

During trip creation or editing, provide the option:

**"Set a maximum number of participants for this trip."**

When enabled, show a field for the maximum total participant count. The
number includes the host.

Example: - Maximum participants: 6. - Host: 1. - Maximum additional
participants: 5.

Clearly explain that the host is included. If the host does not enable
the limit, the trip has no manually configured participant cap.

## 7.2 Changing the limit after creation

The host can enable, disable, or modify the limit after creation.

If a trip already has 5 participants, including the host, the minimum
allowed value is 5.

The host may choose: - 5 --- no additional participants can join. - 6
--- one additional participant can join. - A higher number ---
additional participants can join until the limit is reached.

## 7.3 Reducing the limit

The host cannot set a maximum below the number of people who have
already joined. If 8 participants have joined, the host cannot reduce
the limit to 6.

Changing the limit must never automatically remove existing
participants.

## 7.4 Full trip experience

When the configured maximum is reached: - Display a clear **Trip Full**
status. - Stop new participants from joining. - Prevent invitation links
from bypassing the limit. - Inform interested users that capacity has
been reached. - Allow the host to increase the limit later.

The capacity rule applies consistently to public join requests, private
invitations, and every other joining method.

Pending join requests are not accepted participants. If the last
available place is taken before another request is accepted, the host
should be informed that the trip is now full.

------------------------------------------------------------------------

# 8. Explore --- complete product redesign

## 8.1 Redefining Explore

The existing Explore page should be completely reimagined.

**Remove the current Explore experience, including its existing
recommendations, recommendation sections, and other content that does
not support the new direction. Do not simply add new sections to the
existing page.**

Rebuild Explore around one clear purpose:

**Help travellers find trips to join and help hosts find people to
travel with.**

Explore should become the primary discovery and participation hub of
TripOS. It should not resemble a generic social media feed or a
conventional destination recommendation page.

## 8.2 The centre of Explore: host and join trips

The two primary experiences should be:

1.  **Discover trips to join.**
2.  **Host a trip and invite other travellers to join.**

Public trip discovery should receive the strongest visual priority. The
page should make it immediately obvious that users can browse real
trips, understand their plans, connect with hosts, and request to
participate.

Hosting a trip should also be a prominent, easy-to-find action.

## 8.3 Explore page experience

### Primary actions

-   Host a Trip.
-   Discover Trips.

### Public trip discovery

Display public trips in an attractive, easy-to-browse layout.

Each trip card should show: - Destination image. - Trip title. -
Destination. - Travel dates. - Host identity and profile link. -
Participant count. - Maximum capacity, when configured. - Available
places or full status. - Short description. - Relevant trip category.

Opening a card leads to a dedicated public trip detail page.

### Trip filters

Allow users to discover trips by: - Destination. - Travel month. - Date
range. - Budget range. - Trip category. - Travel style. - Trip
duration. - Participant count. - Available places.

Suggested categories include adventure, backpacking, road trips, weekend
getaways, trekking, beach trips, cultural exploration, food and
experiences, and international travel.

### Trip detail and join experience

The public trip detail page should clearly communicate what the trip is
about, where and when it is happening, the proposed plan, who is hosting
it, how many people have joined, whether places are available, and how
to request to join.

The host remains in control of accepting participants.

## 8.4 Traveller discovery and friendship

Explore should also support discovering travellers.

Users should be able to discover people based on travel interests,
preferred travel styles, favourite destinations, places visited, shared
interests, and mutual friends where appropriate.

Traveller discovery should complement trip discovery, not compete with
it. It should encourage users to connect with people they may genuinely
enjoy travelling with.

## 8.5 What Explore should not become

Explore should not be dominated by: - Generic destination
recommendations. - Generic travel inspiration cards. - An endless,
undifferentiated social feed. - Popularity rankings. - Content that does
not help users discover trips or connect with travellers.

Travel posts and inspiration may be available elsewhere in the social
experience, but the primary purpose of Explore must remain finding and
hosting trips.

**Product principle: Explore is where journeys and travel companions are
discovered. It is not simply where content is scrolled.**

------------------------------------------------------------------------

# 9. Travel social posts and profile content

Introduce a travel-focused posting experience. Users can share travel
experiences, inspire others, and express their travel identity even when
they are not currently organizing a trip.

## 9.1 Types of posts

Users can publish: - Single-photo posts. - Multiple-photo posts. -
Travel experiences. - Destination recommendations. - Short travel
stories. - Travel tips. - Trip announcements. - Highlights from
completed trips.

Each post may include a caption, one or multiple photographs, an
optional destination tag, an optional related trip, creation date, and
visibility setting.

## 9.2 Post visibility

Users can choose: - Public. - Friends. - Only me.

The selected visibility must be respected wherever the post appears.

## 9.3 Social interactions

Users can: - Like posts. - Comment on posts. - View comments. - Delete
their own comments. - Edit or delete their own posts. - Share a post
within TripOS.

Only users permitted to view a post can interact with it.

## 9.4 Social feed

Create a travel-focused feed that may include posts from friends, public
travel posts, travel experiences, destination recommendations, and
public trip announcements.

The feed should prioritize relevant, meaningful travel content. It must
not replace or overwhelm the redesigned Explore page.

## 9.5 Photo-post recommendation

Photo sharing is recommended because travel is inherently visual. It
gives users a reason to return to TripOS, helps travellers express their
experiences, and can inspire others to discover destinations.

However, TripOS should remain focused on travel-related content rather
than becoming a general-purpose photo-sharing application.

------------------------------------------------------------------------

# 10. Memories and social posts must remain separate

**Trip memories and social posts are two different experiences. They
must not automatically become the same content or share the same
visibility rules.**

## 10.1 Trip memories

Memories belong to a specific trip. They are organized around the actual
dates of that journey and are intended to preserve the experience for
trip participants.

They are: - Connected to a specific trip. - Organized by trip date. -
Contributed to by trip participants, subject to permissions. - Intended
as a shared travel journal. - Visible according to trip privacy and
memory permissions.

## 10.2 Social posts

Social posts belong to a user's travel profile. They share selected
experiences with the user's chosen audience.

They are: - Connected to the user's profile. - Able to include
photographs and captions. - Optionally connected to a trip. - Governed
by their own visibility settings. - Viewable and interactive according
to those settings.

## 10.3 Optional sharing of a memory as a post

A user may explicitly choose to share a memory from a trip as a social
post.

The flow: 1. Select a memory or photograph. 2. Choose **Share as Post**.
3. Add or edit a caption. 4. Select post visibility. 5. Publish it to
the profile.

Sharing a memory as a post must not change the original memory or its
permissions. A private trip memory must never become public
automatically.

**Product principle: Memories preserve the journey. Posts share selected
moments with the world.**

------------------------------------------------------------------------

# 11. Date-based trip memories

Enhance the existing Memories module to organize memories by specific
trip dates.

## 11.1 Date-based organization

Every trip has a dedicated Memories section showing its dates.

Example: **Manali Adventure** - 12 December --- Arrival and check-in. -
13 December --- Solang Valley. - 14 December --- Atal Tunnel and
Sissu. - 15 December --- Return journey.

Each date opens a separate memory collection.

## 11.2 Adding memories

Expected flow: 1. Open a trip. 2. Navigate to Memories. 3. Select a trip
date. 4. View existing memories for that date. 5. Upload one or multiple
photographs. 6. Add optional captions. 7. Save the memories.

All uploaded memories should be associated with the selected date.

## 11.3 Memory details

Each memory may include photographs, an optional caption, upload date,
contributor information, optional related location, and optional related
itinerary activity.

## 11.4 Collaborative memories

Multiple trip participants can contribute memories, subject to trip
permissions. The Memories section combines contributions into a
chronological shared travel journal.

Include date-wise galleries, attractive photo layouts, chronological
navigation, member contributions, and optional highlights.

Completed trips should be enjoyable to revisit.

------------------------------------------------------------------------

# 12. Map sharing through chat

Improve the existing trip chat experience so shared locations are
directly actionable.

## 12.1 Location sharing

When a user shares a map location in trip chat, the message should
contain a clickable link to that place.

The location message should display: - Place name. - Location details
where available. - A map preview or location card. - An action such as
**Open in Google Maps**.

## 12.2 Google Maps navigation

When another participant clicks the shared location: - Open the
corresponding location in Google Maps. - On mobile, allow the link to
open the Google Maps application when available. - Otherwise, open the
Google Maps web experience.

The link must point to the intended location, not just a generic map
page.

## 12.3 Location context

Examples include hotels, restaurants, meeting points, tourist
attractions, and activity locations.

The shared location should remain available in chat history.

------------------------------------------------------------------------

# 13. Notifications and social activity

Extend notifications to support social interactions.

**Friendship** - Received friend request. - Friend request accepted.

**Public trips** - New join request. - Join request accepted. - Join
request rejected. - Trip reached maximum capacity. - Host changed trip
visibility.

**Social posts** - Someone liked a post. - Someone commented on a post.

**Trip participation** - Invitation received. - Invitation accepted. -
Participant limit reached.

Users should be able to open a notification and navigate directly to the
relevant profile, trip, post, or request.

Notifications should be useful and appropriately paced, not
overwhelming.

------------------------------------------------------------------------

# 14. Safety, privacy, and community standards

As TripOS becomes a social platform, user safety and privacy become
essential.

The experience should include: - Public and private profiles. - Public,
friends-only, and private posts. - Public and private trips. - Block
users. - Remove friends. - Report inappropriate profiles. - Report
inappropriate posts. - Report inappropriate trips. - Manage unwanted
interactions.

The platform should clearly explain what becomes visible when a user
publishes a profile, post, or trip publicly.

Sensitive personal documents and private trip information must never
become publicly discoverable simply because a user has a public profile
or hosts a public trip.

Privacy settings must be consistent across profiles, Explore, trips,
posts, chat, and memories.

------------------------------------------------------------------------

# 15. Important user journeys

## Journey 1: Find and connect with a traveller

1.  User opens TripOS.
2.  Navigates to Explore or traveller discovery.
3.  Discovers a traveller with similar interests.
4.  Opens the traveller's profile.
5.  Sends a friend request.
6.  The other user receives a notification.
7.  The other user accepts.
8.  Both users become friends and can discover each other's permitted
    travel content.

## Journey 2: Host a public trip

1.  User creates a trip.
2.  Enters trip details.
3.  Selects Public visibility.
4.  Optionally enables a maximum participant limit.
5.  Publishes the trip.
6.  The trip appears in Explore.
7.  Interested travellers discover it.
8.  They review the plan and host profile.
9.  They request to join.
10. The host reviews and accepts suitable participants.

## Journey 3: Join a private trip

1.  Host creates a private trip.
2.  Host shares an invitation link or sends a direct invitation.
3.  Another user opens the invitation.
4.  User reviews the trip details.
5.  User joins according to the invitation's access rules.
6.  The participant becomes part of the trip.

## Journey 4: Host a limited-capacity trip

1.  Host creates a public trip.
2.  Enables the participant limit.
3.  Sets the maximum to 6.
4.  Host counts as the first participant.
5.  Other users request to join.
6.  Host accepts participants.
7.  When the total reaches 6, the trip becomes full.
8.  Further joining is prevented until capacity changes or a place
    becomes available.

## Journey 5: Share a travel post

1.  User opens their profile or social feed.
2.  Selects Create Post.
3.  Uploads photographs.
4.  Adds a caption.
5.  Optionally tags a destination or related trip.
6.  Selects visibility.
7.  Publishes the post.
8.  Eligible users can view and interact with it.

## Journey 6: Add date-based memories

1.  User opens a trip.
2.  Navigates to Memories.
3.  Selects a trip date.
4.  Uploads photographs.
5.  Adds optional captions.
6.  Saves the memories.
7.  Other trip participants can view the date-wise gallery according to
    permissions.

## Journey 7: Share a memory as a social post

1.  User opens a trip memory.
2.  Selects Share as Post.
3.  Chooses the photograph or memory.
4.  Adds a caption.
5.  Selects post visibility.
6.  Publishes it to their profile.
7.  The original trip memory remains unchanged.

## Journey 8: Share a location in chat

1.  User opens a trip chat.
2.  Selects Share Location.
3.  Searches for or selects a place.
4.  Sends the location.
5.  Other participants see the location card.
6.  A participant selects Open in Google Maps.
7.  The intended location opens in Google Maps.

------------------------------------------------------------------------

# 16. Scope and priorities

## Priority 1 --- Social identity and connections

-   Public and private profiles.
-   Profile improvements.
-   Friend requests.
-   Accept and decline requests.
-   Friends list.
-   Blocking and privacy controls.

## Priority 2 --- Public and private trip discovery

-   Public and private trip visibility.
-   Complete Explore redesign.
-   Public trip discovery.
-   Public trip detail pages.
-   Request-to-join workflow.
-   Host approval and rejection.
-   Private trip invitation links.

## Priority 3 --- Participant capacity

-   Optional maximum participant limit.
-   Host-controlled capacity.
-   Capacity changes after trip creation.
-   Participant count validation.
-   Full trip status.
-   Capacity-aware join requests and invitations.

## Priority 4 --- Travel social feed

-   Create photo posts.
-   Multiple-photo uploads.
-   Captions.
-   Destination tags.
-   Post visibility.
-   Likes and comments.
-   Profile post gallery.

## Priority 5 --- Enhanced memories

-   Date-based memory organization.
-   Multiple-photo uploads per date.
-   Collaborative contributions.
-   Chronological galleries.
-   Optional sharing of a memory as a social post.

## Priority 6 --- Chat and location improvements

-   Location cards.
-   Clickable Google Maps links.
-   Improved location-sharing experience.

## Priority 7 --- Social notifications and safety

-   Social notifications.
-   Join-request notifications.
-   Report functionality.
-   Blocking and moderation experiences.

------------------------------------------------------------------------

# 17. Product success criteria

This phase should be considered successful when: 1. Users can manage
public and private profiles. 2. Users can send and accept friend
requests. 3. Users can discover travellers with shared interests. 4.
Hosts can publish public and private trips. 5. Explore is rebuilt around
hosting and discovering trips. 6. Public trips are discoverable through
Explore. 7. Users can request to join public trips. 8. Hosts retain
control over join approvals. 9. Private trips remain accessible only
through authorized invitations. 10. Hosts can configure and manage
maximum participant limits. 11. Participant limits are respected across
every joining method. 12. Users can publish travel-related photo posts.
13. Users can interact with eligible posts. 14. Trip memories remain
separate from profile posts. 15. Users can upload memories against
specific trip dates. 16. Multiple trip participants can contribute
memories. 17. Users can explicitly share selected memories as social
posts. 18. Shared chat locations open the correct Google Maps
destination. 19. Privacy and safety controls work consistently.

------------------------------------------------------------------------

# 18. Long-term vision

TripOS aims to become the social home for travellers.

A place where people discover journeys before they happen, meet people
who share their passion for travel, build friendships, experience trips
together, and preserve memories afterward.

TripOS should not measure its success only through time spent scrolling
or the number of likes received. Its deeper value should come from
meaningful outcomes: - A traveller finds a group to explore a new
destination. - Two people with similar interests become friends. -
Someone discovers a trip they would never have found otherwise. - A host
brings together people for a shared experience. - A group creates
memories that stay with them long after the journey ends.

**The defining social action of TripOS should be helping people discover
and experience journeys together.**

The platform should bring together three experiences:

**DISCOVER** --- Find trips, travellers, and opportunities to travel.

**CONNECT** --- Build genuine friendships and find people to share
journeys with.

**EXPERIENCE** --- Host trips, travel together, share selected moments,
and preserve memories.

**TripOS --- Discover. Connect. Travel. Remember.**
