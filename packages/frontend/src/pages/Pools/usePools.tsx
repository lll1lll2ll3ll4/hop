import React, { useEffect, useState, useMemo } from 'react'
import { BigNumber } from 'ethers'
import { useApp } from 'src/contexts/AppContext'
import { addresses, stakingRewardsContracts } from 'src/config'
import { toPercentDisplay } from 'src/utils'
import { formatTokenString, formatTokenDecimalString } from 'src/utils/format'
import { findNetworkBySlug } from 'src/utils/networks'
import { getTokenImage } from 'src/utils/tokens'
import { useWeb3Context } from 'src/contexts/Web3Context'
import { StakingRewards, StakingRewards__factory } from '@hop-protocol/core/contracts'

const cache : any = {}

export function usePools () {
  const { sdk } = useApp()
  const { address } = useWeb3Context()
  const [userPools, setUserPools] = useState<any[]>([])
  const [pools, setPools] = useState<any[]>([])
  const [isSet, setIsSet] = useState<boolean>(false)
  const [filterTokens, setFilterTokens] = useState<any[]>([])
  const [filterChains, setFilterChains] = useState<any[]>([])
  const [columnSort, setColumnSort] = useState<string>('')
  const [columnSortDesc, setColumnSortDesc] = useState(true)
  const accountAddress = address?.address

  useEffect(() => {
    async function update () {
      const _pools :any[] = []
      for (const token in addresses.tokens) {
        const bridge = sdk.bridge(token)
        for (const chain of bridge.getSupportedLpChains()) {
          const chainModel = findNetworkBySlug(chain)
          const tokenModel = bridge.toTokenModel(token)
          if (!(chainModel && tokenModel)) {
            continue
          }
          const tokenImage = getTokenImage(tokenModel.symbol)
          const poolName = `${token} ${chainModel.name} Pool`
          const poolSubtitle = `${token} - h${token}`
          const depositLink = `/pool/deposit?token=${tokenModel.symbol}&sourceNetwork=${chainModel.slug}`
          const claimLink = `/stake?token=${tokenModel.symbol}&sourceNetwork=${chainModel.slug}`
          _pools.push({
            token: { ...tokenModel, imageUrl: tokenImage },
            chain: chainModel,
            poolName,
            poolSubtitle,
            userBalance: 0,
            userBalanceFormatted: '',
            tvl: 0,
            tvlFormatted: '',
            apr: 0,
            aprFormatted: '',
            stakingApr: 0,
            stakingAprFormatted: '',
            stakingAprChain: null,
            totalApr: 0,
            totalAprFormatted: '',
            depositLink,
            canClaim: false,
            claimLink
          })
        }
      }
      setPools(_pools)
      setIsSet(true)
    }
    update().catch(console.error)
  }, [])

  useEffect(() => {
    async function update() {
      await Promise.all(pools.map(async pool => {
        try {
          const cacheKey = `${pool.token.symbol}:${pool.chain.slug}`
          if (cache[cacheKey]) {
            const tvl = cache[cacheKey]
            pool.tvl = tvl
            pool.tvlFormatted = `$${formatTokenDecimalString(tvl, 0, 4)}`
            setPools([...pools])
            return
          }
          const bridge = sdk.bridge(pool.token.symbol)
          const tvl = await bridge.getTvlUsd(pool.chain.slug)
          cache[cacheKey] = tvl
          pool.tvl = tvl
          pool.tvlFormatted = `$${formatTokenDecimalString(tvl, 0, 4)}`
          setPools([...pools])
        } catch (err: any) {
          // alert(err.message)
          console.error(err)
        }
      }))
    }
    update().catch(console.error)
  }, [isSet])

  useEffect(() => {
    async function update() {
      if (!isSet) {
        return
      }
      if (!accountAddress) {
        for (const pool of pools) {
          pool.userBalance = 0
          pool.userBalanceFormatted = '-'
        }
        setPools([...pools])
        return
      }
      await Promise.all(pools.map(async pool => {
        try {
          const bridge = sdk.bridge(pool.token.symbol)
          const balance = await bridge.getAccountLpCanonicalBalanceUsd(pool.chain.slug, accountAddress)
          if (balance > 0) {
            pool.userBalance = balance
            pool.userBalanceFormatted = `$${formatTokenDecimalString(balance, 0, 4)}`
          } else {
            pool.userBalanceFormatted = '-'
          }
          setPools([...pools])
        } catch (err: any) {
          // alert(err.message)
          console.error(err)
        }
      }))
    }
    update().catch(console.error)
  }, [isSet, accountAddress])

  useEffect(() => {
    async function update() {
      const _userPools = pools.filter((x: any) => {
        return (Number(x.userBalance) > 0)
      })
      setUserPools(_userPools)
    }
    update().catch(console.error)
  }, [pools])

  useEffect(() => {
    async function update() {
      if (filterTokens.length) {
        return
      }
      const tokens :any = {}
      for (const pool of pools) {
        if (!tokens[pool.token.symbol]) {
          tokens[pool.token.symbol] = { ...pool.token, enabled: true }
        }
      }
      setFilterTokens(Object.values(tokens))
    }
    update().catch(console.error)
  }, [pools])

  useEffect(() => {
    async function update() {
      if (filterChains.length) {
        return
      }
      const chains :any = {}
      for (const pool of pools) {
        if (!chains[pool.chain.slug]) {
          chains[pool.chain.slug] = { ...pool.chain, enabled: true }
        }
      }
      setFilterChains(Object.values(chains))
    }
    update().catch(console.error)
  }, [pools])

  async function getPoolStatsFile () {
    const url = 'https://assets.hop.exchange/v1-pool-stats.json'
    const res = await fetch(url)
    const json = await res.json()
    console.log('pool stats data response:', json)
    if (!json.data) {
      throw new Error('expected data')
    }
    return json
  }

  useEffect(() => {
    async function update() {
      const json = await getPoolStatsFile()
      await Promise.all(pools.map(async pool => {
        try {
          let symbol = pool.token.symbol
          const chain = pool.chain.slug

          if (symbol === 'WETH') {
            symbol = 'ETH'
          }
          if (symbol === 'XDAI') {
            symbol = 'DAI'
          }
          if (symbol === 'WXDAI') {
            symbol = 'DAI'
          }
          if (symbol === 'WMATIC') {
            symbol = 'MATIC'
          }
          if (!json.data[symbol]) {
            throw new Error(`expected data for token symbol "${symbol}"`)
          }
          if (!json.data[symbol][chain]) {
            throw new Error(`expected data for network "${chain}"`)
          }
          if (json.data[symbol][chain].apr === undefined) {
            throw new Error(`expected apr value for token "${symbol}" and network "${chain}"`)
          }

          const apr = json.data[symbol][chain].apr ?? 0
          const stakingApr = json.data[symbol][chain].stakingApr ?? 0
          pool.apr = apr
          pool.aprFormatted = toPercentDisplay(apr)
          pool.stakingApr = stakingApr
          pool.stakingAprFormatted = toPercentDisplay(stakingApr)
          pool.totalApr = apr + stakingApr
          pool.totalAprFormatted = toPercentDisplay(apr + stakingApr)
          pool.stakingAprChain = findNetworkBySlug(chain)!

          setPools([...pools])
        } catch (err) {
          pool.aprFormatted = toPercentDisplay(0)
          pool.stakingAprFormatted = toPercentDisplay(0)
          pool.totalAprFormatted = toPercentDisplay(0)

          setPools([...pools])
          console.error(err)
        }
      }))
    }
    update().catch(console.error)
  }, [isSet])

  useEffect(() => {
    async function update() {
      if (!isSet) {
        return
      }
      if (!accountAddress) {
        for (const pool of pools) {
          if (pool.canClaim) {
            pool.canClaim = false
            setPools([...pools])
          }
        }
        return
      }
      await Promise.all(pools.map(async (pool: any) => {
        try {
          const cacheKey = `${pool.chain.slug}:${pool.token.symbol}:${accountAddress}`
          const address = stakingRewardsContracts?.[pool.chain.slug]?.[pool.token.symbol]
          if (address) {
            let earned = BigNumber.from(0)
            if (cache[cacheKey]) {
              earned = cache[cacheKey]
            } else {
              const _provider = sdk.getChainProvider(pool.chain.slug)
              const contract = StakingRewards__factory.connect(address, _provider)
              earned = await contract?.earned(accountAddress)
              cache[cacheKey] = earned
            }
            if (earned.gt(0)) {
              pool.canClaim = true
              setPools([...pools])
            }
          }
        } catch (err) {
          console.error(err)
        }
      }))
    }
    update().catch(console.error)
  }, [isSet, pools, accountAddress])

  function toggleFilterToken (symbol: string) {
    for (const filterToken of filterTokens) {
      if (filterToken.symbol === symbol) {
        filterToken.enabled = !filterToken.enabled
      }
    }
    setFilterTokens([...filterTokens])
  }

  function toggleFilterChain (slug: string) {
    for (const filterChain of filterChains) {
      if (filterChain.slug === slug) {
        filterChain.enabled = !filterChain.enabled
      }
    }
    setFilterChains([...filterChains])
  }

  function toggleColumnSort(column: string) {
    if (column === columnSort) {
      setColumnSortDesc(!columnSortDesc)
    } else {
      setColumnSort(column)
      setColumnSortDesc(true)
    }
  }

  let filteredPools = pools.filter((x: any) => {
    for (const filterToken of filterTokens) {
      if (x.token.symbol === filterToken.symbol && !filterToken.enabled) {
        return false
      }
    }
    for (const filterChain of filterChains) {
      if (x.chain.slug === filterChain.slug && !filterChain.enabled) {
        return false
      }
    }
    return true
  })

  if (columnSort) {
    filteredPools = filteredPools.sort((a, b) => {
      if (columnSortDesc) {
        return b[columnSort] - a[columnSort]
      } else {
        return a[columnSort] - b[columnSort]
      }
    })
  }

  const filteredUserPools = userPools.sort((a, b) => {
    return b.userBalance - a.userBalance
  })

  return {
    pools: filteredPools,
    userPools: filteredUserPools,
    filterTokens,
    filterChains,
    toggleFilterToken,
    toggleFilterChain,
    toggleColumnSort,
    columnSort,
  }
}
