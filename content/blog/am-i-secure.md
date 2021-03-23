---
title: "Are We Secure?"
date: 2021-03-23T00:45:58-07:00
tags: [ "passwords", "security", "philosophy" ]
draft: false
---

What does it mean to be secure? This is the question a friend and I were debating several years ago. We came to the conclusion that if the cost of mounting an attack exceeds the value of the asset being protected, the asset is secure.

Of course, there are practical limitations to evaluating cost and value. <!--more--> There are likely many attack vectors, many of which may be unknown. The asset's value may fluctuate. And the cost of mounting an attack may decrease with time.

More subtly, the value of the asset may be more valuable to the attacker than to the entity protecting it. For example, take the case of a corporation (e.g. 23AndMe) securing public records (e.g. DNA) and a foreign nation state that would like a copy of those records. The corporation has some valuation -- it would be unreasonable, and perhaps infeasible, for a corporation to spend more than it's valuation on securing its assets. But a nation state, or other adversary, may value the assets differently, and hence may be willing to spend far in excess of the corporation's valuation to get the records. This is the dynamic that has been at play between wealthy autocratic countries that steal intellectual property from wealth democratic countries.

So how to protect against it? One approach, is to increase the asymmetry between cost to attack and cost to defend. Generally, it costs less to defend an asset than to attack it. If this is not true, the asset is almost surely lost, unless the attacker's resources are sufficiently constrained to make it impossible. If the cost of attacking an asset is substantially greater than the cost of defending it, an attacker will have to go to great lengths to mount a successful attack.

With many attack vectors, this can be difficult to quantify, so let's take a concrete case -- passwords.

## Passwords

Passwords are stored as hashes, the outputs of one-way mathematical functions such as bcrypt. If the input is known (i.e. user types in their password), the hash can be readily computed and compared to the stored hash -- if the two match, the password is correct.

Conversely, discovering the password from the hash is computationally difficult.

Today, one GPU may be able to compute ~1e10 SHA-1 hashes per second (H/sec). With 95 ASCII characters on an English keyboard, the space of 8 character random passwords, SHA-1 hashed, could be exhausted in 95<sup>8</sup> / 10<sup>9</sup> / 86400 ~= 8 days on one GPU. A 10 character password would take 189 years, or 1 year with 189 GPUs. The cost per hour for a GPU hovers around $0.10 / hour. So an 8 character password is exhaustable for ~$20. A 10 character password for ~$166,000. A 12 character password for $1,500,000,000.

Most assets are probably worth less than 12 characters with a SHA-1 hash.

However, password systems commonly use rounds of hash. For instance, Bitcoin wallet passwords are hashed with 25,000 rounds of SHA-256. The hash rate of SHA-256 is somewhat lower than SHA-1, but with 25,000 rounds needed, the password test rate declines to ~1e5 attempts per second. Now, the 8 character password space takes ~$2 million to exhaust. The 10 character password, ~$17 billion. The 12 character password, ~$150 trillion.

In practice, many passwords are not random selections of the 95 possible keyboard characters. But with a fair 95-sided die, a 12 character password is probably sufficiently long to protect most assets, even with a single iteration through a dated hash function. For many users, even 10 is plenty secure.
