---
clause: B1V1
title: Determination of velocity
citation: NCC 2025 V3 B1V1
web_url: https://ncc.abcb.gov.au/editions/ncc-2025/adopted/volume-three/b-water-services/part-b1-cold-water-services#B1V1
edition: "2025"
volume: volume-three
jurisdiction: aus
defined_terms:
  - Performance Requirement
---

# B1V1 — Determination of velocity

**(1)** Compliance with Performance Requirement B1P2 is verified for a cold-water service in a Class 2 or Class 3 building when the pipework diameter of that service is greater than or equal to the minimum diameter (D_(min)) determined in accordance with the following equation:

D_(min)=√((4Q_(99)×(10)^3)/(πv)) when: v=3m/s,D_(min)≈√(425Q_(99))

where—

(a) D_(min) represents the minimum pipe diameter (mm); and
(b) Q_(99) represents the 99th percentile flow rate (L/s); and
(c) v represents the maximum velocity (m/s).

**(2)** The flow rate must be calculated by determining the greater of—

(a) probable simultaneous flow rate in accordance with (3); or
(b) flow rate of a single fixture with the largest flow rate downstream of the pipework section.

**(3)** For a specific pipe section, the probable simultaneous flow rate must be calculated in accordance with the following equation:

Q_(99)=1/(1−P_0)[∑_(k=1)^Kn_kp_kq_k+(1+P_0)z_(0.99)√((1−P_0)∑_(k=1)^Kn_kp_k(1−p_k)q_k^2−P_0((∑_(k=1)^Kn_kp_kq_k))^2)]

where­—

(a) Q_(99) represents the 99th percentile flow rate (i.e. the designed probable simultaneous flow rate); and
(b) P_0 represents the probability of stagnation during peak usage (zero demand) determined in accordance with (4); and
(c) K represents the total number of fixture groups; and
(d) k represents the index of individual fixture groups; and
(e) n_k is the number of fixtures for a specific fixture group downstream of a pipework section; and
(f) q_k is the specific fixture flow rate; and
(g) p_k is the probability of fixture use (probability that a fixture group is running water during the peak period of water consumption) determined in accordance with (5); and
(h) z_(99) represents the 99th percentile of the standard normal distribution and is equal to 2.362.

**(4)** The probability of stagnation during peak usage must be determined in accordance with the following equation:

P_0=∏_(k=1)^K((1−p_k))^(n_k)

where—

(a) P_0 represents the probability of stagnation during peak usage (zero demand); and
(b) K represents the total number of fixture groups; and
(c) k represents the index of individual fixture groups; and
(d) n_k is the number of fixtures for a specific fixture group downstream of the pipework section; and
(e) p_k is the probability of fixture use (probability that a fixture group is running water during the peak period of water consumption) determined in accordance with (5).

**(5)** The probability of fixture use must be calculated in accordance with the following equation:

p_k=p_(k,B)+F_(o,B)

where—

(a) p_k represents the probability of fixture use; and
(b) p_(k,B) is the baseline probability of fixture use determined in accordance with (6); and
(c) F_(o,B) represents the probability adjustment factor according to occupancy calculated in accordance with (7).

**(6)** The baseline probability of fixture use must be determined in accordance with the following:

p_(k,B)=p_(k,1) when: B=1

p_(k,B)=c_1p_(k1)B^(−c_2) when: 2≤B≤20

p_(k,B)=c_1p_(k1)(20)^(−c_2) when: B>20

where—

(a) p_(k,B) is the baseline probability of fixture use; and
(b) B represents the number of apartments drawing water downstream of the pipe section; and
(c) p_(k,1),c_1,c_2 are coefficients from Table B1V1.

**(7)** The probability adjustment factor must be determined in accordance with the following:

F_(o,B)=m_(k,B)(o−B)

where—

(a) F_(o,B) represents the probability adjustment factor according to occupancy; and
(b) B represents the number of apartments drawing water downstream of the pipe section; and
(c) o represents the estimated total number of building occupants drawing water downstream of the pipe section; and
(d) m_(k,B) represents the increased probability of fixture use per additional building occupant over B calculated in accordance with (8).

**(8)** The increased probability of fixture use per additional building occupant over B must be determined in accordance with the following:

m_(k,B)=c_3B^(−c_4)when B>1

where—

(a) m_(k,B) represents the increased probability of fixture use per additional building occupant over B; and
(b) B represents the number of apartments drawing water downstream of the pipe section; and
(c) c_3,c_4 are coefficients from Table B1V1.

### Table B1V1 — Fixture probability coefficients

| Fixture | P_(k,1) | C_1 | C_2 | C_3 | C_4 |
| --- | --- | --- | --- | --- | --- |
| Shower | 0.061 | 0.908 | -0.475 | 0.020 | -1.343 |
| Tap | 0.009 | 1 | 0 | 0.004 | -0.880 |
| Toilet | 0.002 | 1 | 0 | 0.002 | -0.880 |
| Washing machine | 0.031 | 0.976 | -0.515 | 0.005 | -1.349 |
| Dishwasher | 0.001 | 1 | 0 | 0.0005 | -0.880 |
| Bath | 0.006 | 1.460 | -0.411 | 0.008 | -1.768 |

> The probability coefficient (P_k) for taps is for all locations (e.g. kitchen, laundry and bathroom).

> **Fixture flow rates**
>
> The velocity limit defined by B1P2 is an upper limit value and does not necessarily represent a suitable velocity for water service components, equipment, and pipework materials. Confirmation should be sought on suitable velocities for the products and any specific design and installation criteria.
>
> It is recognised that not all water service components are selected based on the 99th percentile flowrate. The practitioner must ensure appropriate use of B1V1(3) when selecting components using the 99th percentile flowrate.
>
> Fixture flowrates can be determined based on the type selected for a particular project.
>
> Recommended fixture flowrates (q_k) for water efficiency fixtures and appliances are as follows:
>
> - Shower: 0.15 L/s.
> - Tap (basin): 0.08 L/s.
> - Tap (kitchen): 0.12 L/s.
> - Tap (laundry): 0.12 L/s.
> - Toilet (3/4.5 L): 0.19 L/s.
> - Washing machine: 0.22 L/s.
> - Dishwasher: 0.08 L/s.
> - Bath: 0.3 L/s.

> **Building size and occupancy**
>
> Research has shown the probability of fixture use is dependent on building size and occupancy. The following parameters are built into probability of fixture use equations:
>
> - Building size (number of apartments).
> - Building occupancy (estimated number of occupants) drawing water downstream from the subject pipe section.
>
> Consideration should be given to the anticipated occupancy for each apartment building. Where the building occupancy is not known, the number of bedrooms for each dwelling can be used as an indicator of the anticipated building occupancy. Statistics on average building occupancy may be utilised to make informed assumptions.
>
> Values in Table B1V1 are derived from fixture use characteristics considering the results presented in several relevant Australian residential end-use studies that have monitored fixture usage in detached residential dwellings.
