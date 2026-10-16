import json, os
OUT=__import__("os").path.join(__import__("os").path.dirname(__file__),"content")
BASE="https://packpts.com"
ORG={"@type":"Organization","@id":BASE+"/#org","name":"PackPTS","url":BASE+"/","logo":BASE+"/og-image.png?v=2","email":"support@packpts.com"}
SITE={"@type":"WebSite","@id":BASE+"/#website","name":"PackPTS","url":BASE+"/","publisher":{"@id":BASE+"/#org"}}
APP={"@type":["VideoGame","WebApplication"],"@id":BASE+"/#game","name":"PackPTS","url":BASE+"/","applicationCategory":"GameApplication","operatingSystem":"Web","genre":"Trivia","gamePlatform":"Web browser","description":"A free sports card game: name the player on a real trading card with the name masked, earn points, and redeem them for eBay rebates.","offers":{"@type":"Offer","price":"0","priceCurrency":"USD"},"publisher":{"@id":BASE+"/#org"}}
def faq(qs): return {"@type":"FAQPage","mainEntity":[{"@type":"Question","name":q,"acceptedAnswer":{"@type":"Answer","text":a}} for q,a in qs]}
def crumbs(items): return {"@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":i+1,"name":n,"item":BASE+u} for i,(n,u) in enumerate(items)]}
def ld(*nodes): return {"@context":"https://schema.org","@graph":list(nodes)}

HOWQ=("How does PackPTS work?","We deal a real trading card with the player's name masked. You pick the player from four choices, and every right answer earns points.")
FREEQ=("Is PackPTS free?","Yes. PackPTS is free to play in any web browser, on your phone or your computer, with nothing to download.")
POINTSQ=("What can I do with points?","Points are redeemable for eBay rebates now. When you buy a card on eBay through PackPTS, your rebate equals the commission eBay confirms on that sale.")
CARDSQ=("Where do the cards come from?","Every card is a real, licensed trading card from a classic or modern set that our team scans, checks and masks by hand. Players never create cards.")

core={}
core["/"]=dict(
 title="PackPTS: Name the Player Sports Card Game | Earn Points",
 description="Name the player on real sports cards with the name masked. Play the free Daily 5, explore classic sets, and earn points for eBay rebates.",
 h1="Name the Player on Classic Sports Cards",
 answer="PackPTS is a free sports card game where you see a real trading card with the name masked and pick the player from four choices.",
 body="""Remember sorting a fresh rack pack on the living room floor, calling out every face before you flipped the card over? PackPTS is that feeling, any time you want it.

Each round deals a real card from a set collectors love, from the wood grain borders of the late eighties to sharp modern chrome. The name is covered. The photo, the uniform, the pose and the design are all yours to read. Pick the right player from four choices and you earn points.

Start with the Daily 5: the same five cards for everyone, new every day, so you can compare scores with your friends and the rest of the hobby. Want more? Open a set and play as much as you like, from 1986 Topps Baseball to 1990 Hoops to 2022 Panini Chronicles Football.

Your points do real work. They are redeemable for eBay rebates now, so the time you spend sharpening your eye can help you add the next card to your own collection.

Every card in PackPTS comes from a real, licensed set, scanned and checked by our team. Players never create cards, and every mask is reviewed by hand so the game stays fair for everyone.

Free to play in your browser, no download needed. Deal yourself in.""",
 faq=[HOWQ,FREEQ,("What is the Daily 5?","The Daily 5 is five cards, the same for every player, refreshed once a day. It is the quickest way to play and compare scores."),POINTSQ,CARDSQ],
 links=[("Play the Daily 5","/daily"),("Browse all sets","/sets"),("How to play","/how-to-play"),("How points work","/points"),("About PackPTS","/about")],
 crumbs=[("Home","/")], extra=[SITE,ORG,APP])
core["/daily"]=dict(
 title="Daily 5: A Daily Sports Card Guessing Game | PackPTS",
 description="Five real sports cards, names masked, the same for everyone and new every day. Name the players, keep your streak, and earn points. Free.",
 h1="Daily 5: Five Cards. Name Them.",
 answer="The Daily 5 is a free daily sports card game: five real cards with the names masked, the same five for everyone, and a new hand every day.",
 body="""If you love a daily puzzle, you will feel right at home here, only our letters are cardboard.

Every day we deal one hand of five real trading cards. The names are masked, and you pick each player from four choices. Everyone in the hobby gets the same five, so when you share your score, your friends are playing the exact hand you played.

The cards come from sets collectors grew up with: Topps, Donruss, Fleer, Upper Deck, Hoops and Panini, across baseball, basketball and football. One day might lean on the junk wax era, the next on a modern football set. Reading the clues is half the fun. Look at the uniform, the border, the photo style and the stance, and trust your gut.

Each right answer earns points, and points are redeemable for eBay rebates now. Come back tomorrow and keep your streak alive.

Finished your hand and want more? Every set in PackPTS is open for free play, as many rounds as you like.""",
 faq=[("When does the Daily 5 change?","A new hand is dealt once a day. Everyone plays the same five cards that day."),("Is the Daily 5 like Wordle?","It has the same daily rhythm and shared puzzle, but with real sports cards: you name the masked player on each card from four choices."),("Do I need an account?","You can start playing right away. Signing in saves your points and streak."),POINTSQ,FREEQ],
 links=[("Play more sets","/sets"),("How to play","/how-to-play"),("How points work","/points"),("Home","/")],
 crumbs=[("Home","/"),("Daily 5","/daily")], extra=[APP])
core["/sets"]=dict(
 title="Sports Card Sets to Play: Baseball, Basketball, Football",
 description="Play classic and modern card sets on PackPTS: 1986 Topps, 1988 Topps, 1987 Donruss, 1990 Hoops, 1995 Upper Deck and more. Free to play.",
 h1="Play Your Favorite Card Sets",
 answer="PackPTS lets you play full trading card sets one card at a time: pick a set, see a real card with the name masked, and name the player.",
 body="""Every collector has a set that takes them straight back. Maybe it is the wood grain of 1987 Topps, the dark ebony borders of 1987 Donruss, or the full bleed photos of 1995 Upper Deck. Here you can play the set you remember, card by card.

Each set page deals real cards from that release with the name masked. Pick the player from four choices and earn points as you go. Play one round over coffee or work through a few hundred cards on a slow Sunday.

We cover baseball, basketball and football, from the overproduced and much loved junk wax era to modern releases. Every set is scanned and reviewed by our team, and every mask is checked by hand before a set goes live. Players never create cards.

New sets join the shelf as they pass review, so check back often and see which old favorite has been added to the rotation.""",
 faq=[("Which sets can I play?","All public sets are listed on this page, across baseball, basketball and football, from the mid eighties to modern releases."),("How many cards are in each set?","Each set page lists how many cards are in its playable pool. Some sets have a few dozen, others several hundred."),("What is the junk wax era?","The junk wax era is the late eighties and early nineties, when card makers printed huge runs. Those sets are cheap to collect and full of nostalgia."),CARDSQ,FREEQ],
 links=[("Play the Daily 5","/daily"),("How to play","/how-to-play"),("How points work","/points")],
 crumbs=[("Home","/"),("Sets","/sets")], extra=[])
core["/points"]=dict(
 title="How PackPTS Points and eBay Rebates Work",
 description="Earn points for every player you name on PackPTS. Points are redeemable for eBay rebates now. Here is how earning, holds and rebates work.",
 h1="How Points and eBay Rebates Work",
 answer="You earn PackPTS points by naming players correctly, and points are redeemable for eBay rebates now when you buy cards on eBay through PackPTS.",
 body="""We built PackPTS for people who love cards, so it felt right that playing should help you find your next one.

Earning points. Every right answer in the Daily 5 or a set game earns points. They collect in your wallet, which visible at the top of the app after a game ends.

Using points. Points are redeemable for eBay rebates now. Browse real card listings in PackPTS, and when you buy through PackPTS, your rebate equals the commission eBay confirms on that sale. We only credit a rebate after eBay confirms the sale, so every rebate is backed by a real purchase.

The hold. Rebates are held for 60 days, which covers eBay's return window. If eBay marks a sale final sooner, the rebate can release earlier. If an item is returned, the held rebate is removed.

Limits. Daily and weekly limits per player keep the program fair for everyone.

Listings display an estimate of what you could get back. The final rebate is always what eBay confirms. We never promise a set amount, and we will always tell you exactly what was credited.""",
 faq=[POINTSQ,("How do I earn points?","Name the masked player correctly in the Daily 5 or any set game. Each right answer adds points to your wallet."),("Why is there a hold on rebates?","eBay purchases can be returned, so rebates are held for 60 days, or released sooner when eBay marks a sale final."),("What happens if I return an item?","The rebate held for that sale is removed."),("Do points expire?","Check your wallet for current details. We will always tell you before anything about your points changes.")],
 links=[("Play the Daily 5","/daily"),("Browse sets","/sets"),("How to play","/how-to-play")],
 crumbs=[("Home","/"),("Points","/points")], extra=[])
core["/how-to-play"]=dict(
 title="How to Play PackPTS: Guess the Player on Sports Cards",
 description="How PackPTS works: see a real sports card with the name masked, pick the player from four choices, earn points. Rules, tips and FAQ.",
 h1="How to Play PackPTS",
 answer="To play PackPTS, look at a real sports card with the player's name masked, then choose the right player from four options to earn points.",
 body="""It takes ten seconds to learn and a lifetime of flipping through binders to master.

1. Pick a game. Play the Daily 5, the same five cards for everyone each day, or open any set and play freely.

2. Read the card. The name is masked, but everything else is real: the photo, the uniform, the team colors, the border and the design. Card collectors read these clues without thinking.

3. Choose from four. Tap the player you think it is. Right answers earn points.

4. See the reveal. After you answer, the card is revealed so you learn something every round.

Tips from the hobby. Start with the team. Uniforms and logos narrow it fast. Then think about the era: the set design tells you the year, and the year tells you who was on the roster. Position helps too. A catcher's gear or a quarterback's stance is a giveaway.

Fair play. Every mask is checked by hand, and the answer choices for a card stay the same however many times you load it. Players never create cards; every card comes from a real set reviewed by our team.

Like Wordle, but with cardboard: one shared daily puzzle, plus all the free play you want.""",
 faq=[HOWQ,("How many choices do I get?","Each card has four choices and one of them is right."),("Is it like Wordle for sports?","Yes in spirit. The Daily 5 is one shared puzzle each day, and you can play full sets any time."),("What sports are included?","Baseball, basketball and football, across classic and modern sets."),FREEQ,CARDSQ],
 links=[("Play the Daily 5","/daily"),("Browse sets","/sets"),("How points work","/points"),("About PackPTS","/about")],
 crumbs=[("Home","/"),("How to play","/how-to-play")], extra=[])
core["/about"]=dict(
 title="About PackPTS: A Sports Card Game Built by Collectors",
 description="PackPTS is a free sports card guessing game built by collectors. Learn who we are, how we pick and mask cards, and how to reach us.",
 h1="About PackPTS",
 answer="PackPTS is a free, web based sports card game built by collectors, where you name the player on real trading cards and earn points for eBay rebates.",
 body="""PackPTS started at a kitchen table covered in cards. Founder Dave Maloney grew up opening wax packs and sorting commons into shoeboxes, and he wanted a way to bring that feeling back: the instant recognition of a face, a uniform, a set design you have not seen in years.

So we built a game around it. We deal real cards from sets collectors love, mask the name, and let you prove what you know. Every right answer earns points, and points are redeemable for eBay rebates now, so the game feeds the hobby instead of pulling you away from it.

How we handle cards. Every set is scanned and reviewed by our team before it goes live. Every name mask is checked by hand, and we hold back any card that does not meet the bar, whether it is a stamped promo, a framed scan or a mismatched photo. Players never create cards.

Fair play matters to us. Answer choices stay fixed for each card, and nothing in our pages gives away a card in play.

Questions, ideas or a set you want to see? Email us at support@packpts.com. We read every message.""",
 faq=[("Who makes PackPTS?","PackPTS is built by a small team of collectors led by founder Dave Maloney."),CARDSQ,("How do you keep the game fair?","Every mask is reviewed by hand, answer choices stay fixed for each card, and our pages never reveal cards in play."),("How can I contact you?","Email support@packpts.com."),FREEQ],
 links=[("Play the Daily 5","/daily"),("Browse sets","/sets"),("How to play","/how-to-play"),("How points work","/points")],
 crumbs=[("Home","/"),("About","/about")], extra=[ORG])

# set facts: set-level only
NOTES={
"1986 Topps Baseball":("Bold dark top band carrying the team name over clean pale borders, one of the most recognizable designs of the decade.","The mid eighties, just before the junk wax boom"),
"1995 Upper Deck Basketball":("Glossy full bleed photography edge to edge, the look that made Upper Deck the premium name of the nineties.","The nineties premium era"),
"1988 Topps Baseball":("Crisp bright borders with a bright team banner, a simple design that defined a huge print run.","The heart of the junk wax era"),
"1987 Donruss Baseball":("Striking dark ebony borders that reveal every bit of wear, which makes a sharp copy a real prize.","The early junk wax era"),
"1990 Hoops Basketball":("The second year of NBA Hoops, with bright borders and action photos from the league's golden era.","The junk wax era"),
"2022 Panini Chronicles Football":("A multi brand release that gathers many classic Panini designs into one set, so every pack feels like a sampler.","The modern era"),
"1987 Topps Football":("Clean bright borders with team colors, from the classic Topps football run of the eighties.","The mid eighties"),
"1989 Fleer Basketball":("Bright borders with colorful striping, a favorite of late eighties hoops collectors.","The junk wax era"),
"1994 Topps Football":("Glossy nineties photography with a modern feel, from the era when football cards went premium.","The nineties"),
"2024 Basketball":("A modern Topps basketball release with sharp, current era photography.","The modern era"),
"1989 Topps":("Bright borders with a curved color ribbon along the bottom, one of the most familiar baseball designs ever printed.","The heart of the junk wax era"),
"1987 Topps":("The famous wood grain borders, a nod to the classic 1962 design and an all time collector favorite.","The early junk wax era"),
}
def slug(n): return n.lower().replace(" ","-")
sets=json.load(open(OUT+"/_live_sets_snapshot.json"))["sets"]
setpages=[]
for s in sets:
    if s.get("isUserCreated"): continue
    n=s["setName"]; sport=s["sport"]; disp=n if sport in n.lower() else f"{n} {sport.title()}"
    design,era=NOTES[n]; path=f"/sets/{slug(n)}-{s['id'][:8]}"; cnt=s["cardCount"]
    qs=[(f"What is the {disp} game?",f"It is a free PackPTS game that deals real {disp} cards with the player's name masked. You pick the player from four choices."),
        (f"How many {disp} cards can I play?",f"The PackPTS pool for {disp} has {cnt} playable cards, each scanned and checked by our team."),
        (f"What year is {disp}?",f"The set is listed as {s['year']}, from {era.lower()}."),
        (f"Who made {disp}?",f"{s['brand']} produced this set."),
        (f"Where can I find a full {disp} checklist?","We keep the game fair by not publishing a card by card checklist for sets in play. Hobby references like Baseball Card Pedia and PSA's set guides list full checklists.")]
    p=dict(path=path,setId=s["id"],
      title=(f"{disp} Card Game: Guess the Player | PackPTS" if len(f"{disp} Card Game: Guess the Player | PackPTS")<=60 else f"{disp}: Guess the Player | PackPTS"),
      description=f"Play {disp} on PackPTS. See real cards with the names masked, pick the player from four choices, and earn points. Free to play.",
      h1=f"{disp}: Name the Player Game",
      answer=f"Play {disp} on PackPTS: we deal a real {disp} card with the name masked, and you pick the player from four choices. Free, no download.",
      facts={"year":s["year"],"brand":s["brand"],"sport":sport,"playableCards":cnt,"era":era,"designNotes":design},
      body=f"""Pull up a chair, collector. {disp} is dealt and waiting.\n\n{design} If you opened packs back then, you will know this design in a heartbeat. If you are new to it, this is a fun way to meet a set the hobby still talks about.\n\nEvery round deals one real card from our pool of {cnt} {disp} cards. The name is masked, and you choose the player from four options. Read the uniform, the photo and the team colors, and trust what you know. Right answers earn points, and points are redeemable for eBay rebates now.\n\nEvery card is scanned and checked by our team, and every mask is reviewed by hand. Players never create cards.""",
      faq=qs,links=[("Play this set",f"/game/solo?setId={s['id']}"),("All sets","/sets"),("Daily 5","/daily"),("How to play","/how-to-play")],
      crumbs=[("Home","/"),("Sets","/sets"),(disp,path)],
      coverImages=[{"src":u,"alt":f"Masked {disp} card"} for u in s.get("coverCardUrls",[])])
    p["jsonld"]=ld(crumbs(p["crumbs"]),faq(qs),{"@type":"WebPage","url":BASE+path,"name":p["title"],"isPartOf":{"@id":BASE+"/#website"},"about":{"@type":"CreativeWork","name":disp,"dateCreated":str(s["year"]),"publisher":{"@type":"Organization","name":s["brand"]}}})
    setpages.append(p)
for path,c in core.items():
    c["path"]=path; c["jsonld"]=ld(*(c.pop("extra")+[crumbs(c["crumbs"]),faq(c["faq"])]))
    c["wordCount"]=len(c["body"].split())
for p in setpages: p["wordCount"]=len(p["body"].split())
json.dump({"core":list(core.values())},open(OUT+"/core-pages.json","w"),indent=2)
json.dump({"sets":setpages},open(OUT+"/set-pages.json","w"),indent=2)
def md(p):
    s=f"# {p['path']}\n\n- Title: {p['title']} ({len(p['title'])} chars)\n- Description: {p['description']} ({len(p['description'])} chars)\n- H1: {p['h1']}\n\n**Opening:** {p['answer']}\n\n{p['body']}\n\n"
    if "facts" in p: s+="## Set facts\n"+"".join(f"- {k}: {v}\n" for k,v in p["facts"].items())+"\n"
    s+="## FAQ\n"+"".join(f"**{q}**\n{a}\n\n" for q,a in p["faq"])+"## Links\n"+"".join(f"- [{t}]({u})\n" for t,u in p["links"])
    return s
open(OUT+"/core-pages.md","w").write("\n---\n\n".join(md(p) for p in core.values()))
open(OUT+"/set-pages.md","w").write("\n---\n\n".join(md(p) for p in setpages))
for p in list(core.values())+setpages:
    assert len(p["title"])<=60,(p["title"],len(p["title"])); assert len(p["description"])<=155,(p["description"],len(p["description"]))
    assert 4<=len(p["faq"])<=6
for p in core.values(): assert 150<=p["wordCount"]<=400,(p["path"],p["wordCount"])
print("ok",[(p["path"],p["wordCount"]) for p in core.values()])
