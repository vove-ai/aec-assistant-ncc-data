---
clause: B1V1
title: Structural reliability
citation: NCC 2025 V1 B1V1 (NSW)
web_url: https://ncc.abcb.gov.au/editions/ncc-2025/adopted/volume-one/5-new-south-wales/nsw-b1-structural-provisions
edition: "2025"
volume: volume-one
jurisdiction: nsw
defined_terms:
  - Verification Method
---

# B1V1 — Structural reliability

**(1)** This Verification Method is applicable to components with a resistance coefficient of variation of at least 10% and not more than 40%.

**(2)** Where a component has a calculated resistance coefficient of variation of less than 10%, then a minimum value of 10% must be used.

**(3)** Compliance with B1P1 and B1P2 is verified for the design of a structural component for strength where—

(a) the capacity reduction factor ϕ satisfies ϕ≤Average(ϕ_G,ϕ_Q,ϕ_W,...), where ϕ_G,ϕ_Q,ϕ_W,... are capacity reduction factors for all relevant actions and must contain at least permanent (G), imposed (Q) and wind (W) actions; and
(b) the capacity reduction factors ϕ_G,ϕ_Q,ϕ_W,... are calculated for target reliability indices for permanent action β_(TG), for imposed action β_(TQ), for wind action β_(TW),… in accordance with the equation: β=In[(R¯)/(S¯)√((C_S)/(C_R))]/√(In(C_R.C_S)), where—
  (i) ((R¯)/(S¯))=((γ/ϕ))/(((S¯)/(S_N)))((R¯)/(R_N)); and
  (ii) CR=1+V_R^2, C_S=1+V_S^2, where—
    (A) (R¯)/(R_N) = ratio of mean resistance to nominal; and
    (B) (S¯)/(S_N) = ratio of mean action to nominal; and
    (C) C_S = correction factor for action; and
    (D) C_R = correction factor for resistance; and
    (E) V_S = coefficient of variation of the appropriate action as given in NSW Table B1V1a; and
    (F) V_R = coefficient of variation of the resistance; and
    (G) γ = appropriate load factor for the action as given in AS/NZS 1170.0; and
    (H) ϕ = capacity factor for the appropriate action; and
(c) the annual target reliability indices β_(TG),β_(TQ),β_(TW),... are established as follows:
  (i) For situations where it is appropriate to compare an equivalent Deemed-to-Satisfy product, a resistance model must be established for the equivalent Deemed-to-Satisfy product and β_(TG),β_(TQ),β_(TW),... must be calculated for the equivalent Deemed-to-Satisfy product in accordance with the equation given at (b).
  (ii) The target reliability indices β_(TG),β_(TQ),β_(TW),... thus established, must be not less than those given in NSW Table B1V1b minus 0.5.
  (iii) For situations where it is not appropriate to compare with an equivalent Deemed-to-Satisfy product, the target reliability index β must be as given in NSW Table B1V1b.

**(4)** The resistance model for the component must be established by taking into account variability due to material properties, fabrication and construction processes and structural modelling.

**NSW variation (INSERT)**

### Table B1V1a — Annual action models

| Design action | Ratio of mean action to nominal | Coefficient of variation of the action |
| --- | --- | --- |
| Permanent action (γ_G=1.35) | (G−/G_N)=1.00 | V_G=0.10 |
| Imposed action (γQ=1.50) | (G¯/G_N)=0.50 | V_Q=0.43 |
| Wind action (γW=1.00) (non-cyclonic) | (W¯/W_N)=0.33 | V_W=0.49 |
| Wind action (γW=1.00) (cyclonic) | (W¯/W_N)=0.16 | V_W=0.71 |
| Snow action (γS=1.00) | (S¯/S_N)=0.29 | V_S=0.57 |
| Earthquake action (γE=1.00) | (E¯/E_N)=0.05 | V_E=1.98 |

**NSW variation (INSERT)**

### Table B1V1b — Annual target reliability indices

| Type of action | Target reliability index β |
| --- | --- |
| Permanent action | 4.3 |
| Imposed action | 4.0 |
| Wind, snow and earthquake action | 3.7 |

> (1) Table B1V1b is applicable for components that exhibit brittle failure similar to concrete as specific in AS 3600.
> (2) For components with creep characteristics similar to timber as specified in AS 1720.1, the target reliability index for permanent action must be increased to 5.0.
> (3) The above target reliability indices are based on materials or systems that exhibit creep or brittle failure similar to timber or concrete.
> (4) Table B1V1b may also be applicable to materials or systems that exhibit creep or brittle failure differently to steel, timber or concrete provided the creep or brittle nature of the material or system are properly accounted for in the design model.
> (5) The above target reliability indices are also applicable for materials or systems that exhibit ductile failure characteristics.
