/**
 * Common English words (frequency-ordered, hand-curated). Used by word-based modes.
 * @module core/corpus/words
 */
export const COMMON_WORDS = Object.freeze(
  `the be to of and a in that have it for not on with he as you do at this but his by from
they we say her she or an will my one all would there their what so up out if about who get
which go me when make can like time no just him know take people into year your good some
could them see other than then now look only come its over think also back after use two how
our work first well way even new want because any these give day most us is was are were been
being has had did said made find here thing many much where through long little very down
should still own great old year while last might right same too world under never place
again tell turn small set put end does another large must big even such because why ask went
men read need land different home move try kind hand picture change off play spell air away
animal house point page letter mother answer found study learn plant cover food sun four
between state keep eye never last let thought city tree cross farm hard start story saw far
sea draw left late run while press close night real life few north open seem together next
white children begin got walk example ease paper group always music those both mark often
until mile river car feet care second book carry took science eat room friend began idea fish
mountain stop once base hear horse cut sure watch color face wood main enough plain girl usual
young ready above ever red list though feel talk bird soon body dog family direct pose leave
song measure door product black short numeral class wind question happen complete ship area
half rock order fire south problem piece told knew pass since top whole king space heard best
hour better during hundred five remember step early hold west ground interest reach fast verb
sing listen six table travel less morning ten simple several vowel toward war lay against
pattern slow center love person money serve appear road map rain rule govern pull cold notice
voice unit power town fine certain fly fall lead cry dark machine note wait plan figure star
box noun field rest correct able pound done beauty drive stood contain front teach week final
gave green quick develop ocean warm free minute strong special mind behind clear tail produce
fact street inch multiply nothing course stay wheel full force blue object decide surface deep
moon island foot system busy test record boat common gold possible plane stead dry wonder
laugh thousand ago ran check game shape equate miss brought heat snow tire bring yes distant
fill east paint language among`
    .split(/\s+/)
    .filter((w, i, a) => w && a.indexOf(w) === i),
);

/** Short words used by lesson drills and as weak-key filler. */
export const SHORT_WORDS = Object.freeze(COMMON_WORDS.filter((w) => w.length <= 4));
