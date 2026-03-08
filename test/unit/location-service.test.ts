import { describe, test, expect, vi, beforeEach } from "vitest";
import { LocationService } from "../../src/services/location-service.ts";
import type { AppContext, Address } from "../../src/types.ts";
import type { Page } from "playwright";

// Mock the location-flow module
vi.mock("../../src/playwright/location-flow.ts", () => ({
  setLocation: vi.fn(),
  getAddresses: vi.fn(),
  selectAddress: vi.fn(),
}));

import {
  setLocation as setLocationFlow,
  getAddresses as getAddressesFlow,
  selectAddress as selectAddressFlow,
} from "../../src/playwright/location-flow.ts";

describe("LocationService", () => {
  let mockContext: AppContext;
  let mockPage: Page;
  let locationService: LocationService;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create mock page
    mockPage = {
      isClosed: vi.fn(() => false),
    } as unknown as Page;

    // Create mock AppContext
    mockContext = {
      logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      browserManager: {
        ensurePage: vi.fn(async () => mockPage),
      },
      config: {} as any,
      httpClient: {} as any,
      sessionManager: {} as any,
      rateLimiter: {} as any,
      spendingGuard: {} as any,
    };

    locationService = new LocationService(mockContext);
  });

  describe("setLocation", () => {
    test("sets location with address query", async () => {
      const addressQuery = "123 Main St, Delhi";
      vi.mocked(setLocationFlow).mockResolvedValue(undefined);

      const result = await locationService.setLocation({
        address_query: addressQuery,
      });

      expect(mockContext.browserManager.ensurePage).toHaveBeenCalled();
      expect(setLocationFlow).toHaveBeenCalledWith(mockPage, {
        addressQuery: addressQuery,
      });
      expect(result).toBe(`Location set to: ${addressQuery}`);
    });

    test("throws error when address_query is empty", async () => {
      await expect(
        locationService.setLocation({ address_query: "" })
      ).rejects.toThrow("Provide an address_query to search for a location");

      expect(mockContext.browserManager.ensurePage).not.toHaveBeenCalled();
      expect(setLocationFlow).not.toHaveBeenCalled();
    });

    test("throws error when address_query is missing", async () => {
      await expect(
        locationService.setLocation({ address_query: "" })
      ).rejects.toThrow("Provide an address_query to search for a location");

      expect(setLocationFlow).not.toHaveBeenCalled();
    });

    test("handles various address formats", async () => {
      const addresses = [
        "Connaught Place, New Delhi",
        "MG Road, Bangalore",
        "123, ABC Apartments, Sector 5, Noida",
      ];

      for (const address of addresses) {
        vi.clearAllMocks();
        vi.mocked(setLocationFlow).mockResolvedValue(undefined);

        const result = await locationService.setLocation({
          address_query: address,
        });

        expect(setLocationFlow).toHaveBeenCalledWith(mockPage, {
          addressQuery: address,
        });
        expect(result).toBe(`Location set to: ${address}`);
      }
    });

    test("ensures browser page before setting location", async () => {
      vi.mocked(setLocationFlow).mockResolvedValue(undefined);

      await locationService.setLocation({ address_query: "Test Address" });

      expect(mockContext.browserManager.ensurePage).toHaveBeenCalledBefore(
        vi.mocked(setLocationFlow)
      );
    });
  });

  describe("getSavedAddresses", () => {
    test("returns addresses without hint", async () => {
      const mockAddresses: Address[] = [
        {
          index: 0,
          label: "Home",
          address_line: "123 Main St, Delhi",
          is_default: true,
        },
        {
          index: 1,
          label: "Work",
          address_line: "456 Office Blvd, Mumbai",
          is_default: false,
        },
      ];

      vi.mocked(getAddressesFlow).mockResolvedValue({
        addresses: mockAddresses,
      });

      const result = await locationService.getSavedAddresses();

      expect(mockContext.browserManager.ensurePage).toHaveBeenCalled();
      expect(getAddressesFlow).toHaveBeenCalledWith(mockPage);
      expect(result).toEqual({
        addresses: mockAddresses,
      });
      expect(result.hint).toBeUndefined();
    });

    test("returns addresses with hint", async () => {
      const mockAddresses: Address[] = [
        {
          index: 0,
          label: "Home",
          address_line: "789 Park Ave, Bangalore",
          is_default: true,
        },
      ];
      const mockHint = "You have 1 saved address";

      vi.mocked(getAddressesFlow).mockResolvedValue({
        addresses: mockAddresses,
        hint: mockHint,
      });

      const result = await locationService.getSavedAddresses();

      expect(mockContext.browserManager.ensurePage).toHaveBeenCalled();
      expect(getAddressesFlow).toHaveBeenCalledWith(mockPage);
      expect(result).toEqual({
        addresses: mockAddresses,
        hint: mockHint,
      });
    });

    test("returns empty addresses array", async () => {
      vi.mocked(getAddressesFlow).mockResolvedValue({
        addresses: [],
      });

      const result = await locationService.getSavedAddresses();

      expect(result).toEqual({
        addresses: [],
      });
      expect(result.hint).toBeUndefined();
    });

    test("handles multiple saved addresses", async () => {
      const mockAddresses: Address[] = [
        {
          index: 0,
          label: "Home",
          address_line: "123 Main St, Delhi",
          is_default: true,
        },
        {
          index: 1,
          label: "Work",
          address_line: "456 Office Blvd, Mumbai",
          is_default: false,
        },
        {
          index: 2,
          label: "Parents",
          address_line: "789 Park Ave, Bangalore",
          is_default: false,
        },
      ];

      vi.mocked(getAddressesFlow).mockResolvedValue({
        addresses: mockAddresses,
        hint: "You have 3 saved addresses",
      });

      const result = await locationService.getSavedAddresses();

      expect(result.addresses).toHaveLength(3);
      expect(result.addresses[0].is_default).toBe(true);
      expect(result.addresses[1].is_default).toBe(false);
      expect(result.addresses[2].is_default).toBe(false);
    });

    test("ensures browser page before getting addresses", async () => {
      vi.mocked(getAddressesFlow).mockResolvedValue({
        addresses: [],
      });

      await locationService.getSavedAddresses();

      expect(mockContext.browserManager.ensurePage).toHaveBeenCalledBefore(
        vi.mocked(getAddressesFlow)
      );
    });
  });

  describe("selectAddress", () => {
    test("selects address by index with hint", async () => {
      const mockHint = "Address at index 0 selected successfully";
      vi.mocked(selectAddressFlow).mockResolvedValue({
        hint: mockHint,
      });

      const result = await locationService.selectAddress(0);

      expect(mockContext.browserManager.ensurePage).toHaveBeenCalled();
      expect(selectAddressFlow).toHaveBeenCalledWith(mockPage, 0);
      expect(result).toBe(mockHint);
    });

    test("selects address by index without hint", async () => {
      vi.mocked(selectAddressFlow).mockResolvedValue({});

      const result = await locationService.selectAddress(2);

      expect(mockContext.browserManager.ensurePage).toHaveBeenCalled();
      expect(selectAddressFlow).toHaveBeenCalledWith(mockPage, 2);
      expect(result).toBe("Address at index 2 selected");
    });

    test("handles selecting first address (index 0)", async () => {
      vi.mocked(selectAddressFlow).mockResolvedValue({
        hint: "Home address selected",
      });

      const result = await locationService.selectAddress(0);

      expect(selectAddressFlow).toHaveBeenCalledWith(mockPage, 0);
      expect(result).toBe("Home address selected");
    });

    test("handles selecting various indices", async () => {
      const testCases = [
        { index: 0, hint: "First address" },
        { index: 1, hint: "Second address" },
        { index: 5, hint: "Sixth address" },
      ];

      for (const { index, hint } of testCases) {
        vi.clearAllMocks();
        vi.mocked(selectAddressFlow).mockResolvedValue({ hint });

        const result = await locationService.selectAddress(index);

        expect(selectAddressFlow).toHaveBeenCalledWith(mockPage, index);
        expect(result).toBe(hint);
      }
    });

    test("uses default message when no hint provided", async () => {
      vi.mocked(selectAddressFlow).mockResolvedValue({});

      const result = await locationService.selectAddress(3);

      expect(result).toBe("Address at index 3 selected");
    });

    test("ensures browser page before selecting address", async () => {
      vi.mocked(selectAddressFlow).mockResolvedValue({});

      await locationService.selectAddress(1);

      expect(mockContext.browserManager.ensurePage).toHaveBeenCalledBefore(
        vi.mocked(selectAddressFlow)
      );
    });
  });
});
